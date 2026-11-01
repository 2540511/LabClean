import type {
  CellValue,
  Column,
  ColumnIssue,
  ColumnType,
  Dataset,
  NumericStats,
} from './types'
import { classify, coerceNumber, formatCell, isBlank, rawText } from './value'

/** 数值采样上限：超过就改用蓄水池抽样，统计量变成估算值（界面上会标出来） */
const RESERVOIR = 200_000
/** 唯一值统计上限，防止超大表把内存吃穿 */
const DISTINCT_CAP = 50_000
const TOP_CAP = 2_000
/** 重复行检测上限 */
const DUP_SCAN_LIMIT = 300_000
/** 异常值判定：修正 Z 分数阈值（Iglewicz & Hoaglin 推荐 3.5） */
const OUTLIER_Z = 3.5

export interface RawSheet {
  name: string
  rows: CellValue[][]
}

interface Acc {
  blank: number
  number: number
  date: number
  boolean: number
  leadingZero: number
  thousands: number
  text: number
  whitespace: number
  /** 数值蓄水池 */
  res: number[]
  resTotal: number
  /** Welford 在线均值/方差，避免 sum of squares 的精度崩塌 */
  wMean: number
  wM2: number
  min: number
  max: number
  sample: string[]
}

function newAcc(): Acc {
  return {
    blank: 0,
    number: 0,
    date: 0,
    boolean: 0,
    leadingZero: 0,
    thousands: 0,
    text: 0,
    whitespace: 0,
    res: [],
    resTotal: 0,
    wMean: 0,
    wM2: 0,
    min: Infinity,
    max: -Infinity,
    sample: [],
  }
}

function pushWelford(acc: Acc, x: number): void {
  const n = acc.resTotal
  const delta = x - acc.wMean
  acc.wMean += delta / n
  acc.wM2 += delta * (x - acc.wMean)
}

function pushReservoir(acc: Acc, n: number): void {
  acc.resTotal++
  pushWelford(acc, n)
  if (acc.res.length < RESERVOIR) {
    acc.res.push(n)
  } else {
    const j = Math.floor(Math.random() * acc.resTotal)
    if (j < RESERVOIR) acc.res[j] = n
  }
}

function countNonEmpty(row: CellValue[]): number {
  let n = 0
  for (const c of row) if (!isBlank(c)) n++
  return n
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  if (sorted.length === 1) return sorted[0]
  const pos = (sorted.length - 1) * p
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  const w = pos - lo
  return sorted[lo] * (1 - w) + sorted[hi] * w
}

/** 数值列统计：中位数 + MAD 的稳健口径 */
function numericStats(acc: Acc): NumericStats {
  const sorted = acc.res.slice().sort((a, b) => a - b)
  const n = acc.resTotal
  const mean = n > 0 ? acc.wMean : NaN
  const variance = n > 0 ? Math.max(0, acc.wM2 / n) : NaN

  const median = quantile(sorted, 0.5)
  const q1 = quantile(sorted, 0.25)
  const q3 = quantile(sorted, 0.75)
  const deviations = sorted.map((x) => Math.abs(x - median)).sort((a, b) => a - b)
  const mad = quantile(deviations, 0.5)
  const iqr = q3 - q1

  let lowFence: number
  let highFence: number
  if (mad > 0) {
    const span = (OUTLIER_Z * mad) / 0.6745
    lowFence = median - span
    highFence = median + span
  } else if (iqr > 0) {
    lowFence = q1 - 1.5 * iqr
    highFence = q3 + 1.5 * iqr
  } else {
    lowFence = -Infinity
    highFence = Infinity
  }

  return {
    n,
    min: acc.min === Infinity ? NaN : acc.min,
    max: acc.max === -Infinity ? NaN : acc.max,
    mean,
    std: Math.sqrt(variance),
    median,
    q1,
    q3,
    mad,
    lowFence,
    highFence,
    outliers: 0,
    outliersLow: 0,
    outliersHigh: 0,
    exact: acc.resTotal <= RESERVOIR,
  }
}

function decideType(acc: Acc): ColumnType {
  const nonBlank = acc.number + acc.date + acc.boolean + acc.text + acc.leadingZero + acc.thousands
  if (nonBlank === 0) return 'text'
  // 前导零、千分位一旦出现，说明这列是「带格式的编号」，必须按文本保留
  if (acc.leadingZero > 0 || acc.thousands > 0) return 'text'
  const numeric = acc.number / nonBlank
  if (numeric >= 0.9) return 'number'
  if (acc.date / nonBlank >= 0.9) return 'date'
  if (acc.boolean / nonBlank >= 0.9) return 'boolean'
  return 'text'
}

function scoreColumn(args: {
  type: ColumnType
  missingRate: number
  outlierRate: number
  invalidRate: number
  whitespace: number
  distinct: number
  nonBlank: number
}): number {
  if (args.nonBlank === 0) return 0
  let s = 100
  s -= Math.min(60, args.missingRate * 100 * 0.6)
  s -= Math.min(25, args.outlierRate * 100 * 1.2)
  s -= Math.min(25, args.invalidRate * 100 * 1.5)
  if (args.whitespace > 0) s -= 3
  if (args.distinct === 1) s -= 5
  return Math.max(0, Math.round(s))
}

function buildIssues(args: {
  acc: Acc
  type: ColumnType
  missing: number
  distinct: number
  outliers: number
  invalid: number
  nonBlank: number
}): ColumnIssue[] {
  const out: ColumnIssue[] = []
  const { acc, type, missing, distinct, outliers, invalid, nonBlank } = args

  if (nonBlank === 0) {
    out.push({ code: 'EMPTY_COLUMN', severity: 'error', count: 0, message: '整列都是空的' })
    return out
  }
  if (missing > 0) {
    out.push({
      code: 'MISSING',
      severity: missing / (missing + nonBlank) > 0.3 ? 'error' : 'warn',
      count: missing,
      message: `${missing} 个单元格为空`,
    })
  }
  if (invalid > 0) {
    out.push({
      code: 'MIXED_TYPE',
      severity: 'warn',
      count: invalid,
      message: `${invalid} 个单元格不是${type === 'number' ? '数字' : '规范格式'}，未参与统计`,
    })
  }
  if (outliers > 0) {
    out.push({
      code: 'OUTLIER',
      severity: 'warn',
      count: outliers,
      message: `${outliers} 个疑似异常值（稳健判据，已标在表里）`,
    })
  }
  if (acc.whitespace > 0) {
    out.push({
      code: 'WHITESPACE',
      severity: 'info',
      count: acc.whitespace,
      message: `${acc.whitespace} 个单元格有多余空格`,
    })
  }
  if (distinct === 1 && nonBlank > 1) {
    out.push({ code: 'CONSTANT', severity: 'info', count: 0, message: '整列只有同一个值' })
  }
  if (acc.leadingZero > 0) {
    out.push({
      code: 'LEADING_ZERO',
      severity: 'info',
      count: acc.leadingZero,
      message: `${acc.leadingZero} 个值带前导零，已按文本保留（避免去掉 0）`,
    })
  }
  if (acc.thousands > 0) {
    out.push({
      code: 'THOUSANDS_SEP',
      severity: 'info',
      count: acc.thousands,
      message: `${acc.thousands} 个值含千分位逗号，已按文本保留`,
    })
  }
  return out
}

function sanitizeHeaders(header: CellValue[], width: number): string[] {
  const names: string[] = []
  const seen = new Map<string, number>()
  for (let c = 0; c < width; c++) {
    let name = rawText(header[c] ?? null).trim()
    if (name === '') name = `列${c + 1}`
    const dup = seen.get(name)
    if (dup === undefined) {
      seen.set(name, 1)
    } else {
      seen.set(name, dup + 1)
      name = `${name}_${dup + 1}`
    }
    names.push(name)
  }
  return names
}

/**
 * 表头判定：跳过开头的空行和「只有一个格子的标题行」。
 * 只在这两种很确定的形态下跳，避免误吃真正的数据行。
 */
export function findHeaderRow(raw: CellValue[][]): number {
  let i = 0
  while (i < raw.length && raw[i].every((c) => isBlank(c))) i++
  while (i < raw.length - 1) {
    const cur = countNonEmpty(raw[i])
    const next = countNonEmpty(raw[i + 1])
    if (cur === 1 && next >= 3) i++
    else break
  }
  return i
}

function makeId(): string {
  return `ds_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/** 核心：根据「列名 + 数据行」完成全量体检 */
export function profileRows(
  name: string,
  sheet: string,
  headers: string[],
  rowsIn: CellValue[][],
  opts: { source?: string; elapsedMs?: number; id?: string } = {},
): Dataset {
  const width = headers.length
  const rows = rowsIn
  const n = rows.length

  // 补齐每行长度，避免后面到处判空
  for (let r = 0; r < n; r++) {
    const row = rows[r]
    if (row.length < width) {
      for (let c = row.length; c < width; c++) row.push(null)
    }
  }

  const accs: Acc[] = []
  for (let c = 0; c < width; c++) accs.push(newAcc())

  // ---- 第一遍：类型识别 + 数值采样 + 重复行哈希 ----
  const checkDup = n <= DUP_SCAN_LIMIT
  const seenRows = checkDup ? new Set<string>() : null
  let duplicateRows = 0
  let missingCells = 0
  let anyWhitespace = 0

  for (let r = 0; r < n; r++) {
    const row = rows[r]
    for (let c = 0; c < width; c++) {
      const v = row[c] ?? null
      const acc = accs[c]
      const kind = classify(v)
      switch (kind) {
        case 'empty':
          acc.blank++
          missingCells++
          break
        case 'number': {
          acc.number++
          const num = Number(v)
          pushReservoir(acc, num)
          if (num < acc.min) acc.min = num
          if (num > acc.max) acc.max = num
          break
        }
        case 'leadingZero':
          acc.leadingZero++
          break
        case 'thousands':
          acc.thousands++
          break
        case 'date':
          acc.date++
          break
        case 'boolean':
          acc.boolean++
          break
        case 'text': {
          acc.text++
          const s = rawText(v)
          if (s !== s.trim()) {
            acc.whitespace++
            anyWhitespace++
          }
          break
        }
      }
    }

    if (seenRows) {
      let key = ''
      for (let c = 0; c < width; c++) {
        key += rawText(row[c] ?? null)
        key += '\u0001'
      }
      if (seenRows.has(key)) duplicateRows++
      else seenRows.add(key)
    }
  }

  // ---- 定类型 ----
  const types: ColumnType[] = accs.map(decideType)

  // ---- 第二遍：按类型收尾（数值转真实数字、文本收唯一值/高频值） ----
  const distinctSets: (Set<string> | null)[] = []
  const topMaps: (Map<string, number> | null)[] = []
  const invalidCounts = new Array<number>(width).fill(0)
  const distinctApprox = new Array<boolean>(width).fill(false)

  for (let c = 0; c < width; c++) {
    const t = types[c]
    if (t === 'number') {
      distinctSets.push(null)
      topMaps.push(null)
    } else {
      distinctSets.push(new Set<string>())
      topMaps.push(new Map<string, number>())
    }
  }

  for (let r = 0; r < n; r++) {
    const row = rows[r]
    for (let c = 0; c < width; c++) {
      const v = row[c] ?? null
      if (isBlank(v)) continue

      if (types[c] === 'number') {
        const num = coerceNumber(v)
        if (num === null) {
          invalidCounts[c]++
          const acc0 = accs[c]
          if (acc0.sample.length < 3) acc0.sample.push(formatCell(v, 'number'))
        } else {
          if (typeof v !== 'number') row[c] = num
          const acc0 = accs[c]
          if (acc0.sample.length < 3) acc0.sample.push(formatCell(num, 'number'))
        }
        continue
      }

      const s = rawText(v).trim()
      if (s === '') continue
      const set = distinctSets[c]!
      if (set.size < DISTINCT_CAP) set.add(s)
      else distinctApprox[c] = true

      const map = topMaps[c]!
      if (map.size < TOP_CAP || map.has(s)) map.set(s, (map.get(s) ?? 0) + 1)

      const acc = accs[c]
      if (acc.sample.length < 3) acc.sample.push(formatCell(v, types[c]))
    }
  }

  // ---- 第三遍：数值列的异常值计数（需要先知道上下围栏） ----
  const numericStatsList: (NumericStats | undefined)[] = new Array(width).fill(undefined)
  for (let c = 0; c < width; c++) {
    if (types[c] !== 'number') continue
    const acc = accs[c]
    if (acc.resTotal === 0) continue
    const stats = numericStats(acc)
    let low = 0
    let high = 0
    for (let r = 0; r < n; r++) {
      const v = rows[r][c]
      if (typeof v !== 'number') continue
      if (v < stats.lowFence) low++
      else if (v > stats.highFence) high++
    }
    stats.outliers = low + high
    stats.outliersLow = low
    stats.outliersHigh = high
    numericStatsList[c] = stats
  }

  // ---- 组装列信息 ----
  const columns: Column[] = []
  let scoreSum = 0
  for (let c = 0; c < width; c++) {
    const acc = accs[c]
    const total = n
    const missing = acc.blank
    const nonBlank = total - missing
    const set = distinctSets[c]
    const topMap = topMaps[c]
    const numeric = numericStatsList[c]

    const top = topMap
      ? [...topMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([value, count]) => ({ value, count }))
      : []

    const issues = buildIssues({
      acc,
      type: types[c],
      missing,
      distinct: set ? set.size : nonBlank,
      outliers: numeric?.outliers ?? 0,
      invalid: invalidCounts[c],
      nonBlank,
    })

    const score = scoreColumn({
      type: types[c],
      missingRate: total > 0 ? missing / total : 0,
      outlierRate: numeric && numeric.n > 0 ? numeric.outliers / numeric.n : 0,
      invalidRate: nonBlank > 0 ? invalidCounts[c] / nonBlank : 0,
      whitespace: acc.whitespace,
      distinct: set ? set.size : nonBlank,
      nonBlank,
    })

    scoreSum += score
    columns.push({
      key: `c${c}`,
      name: headers[c],
      index: c,
      type: types[c],
      missing,
      missingRate: total > 0 ? missing / total : 0,
      distinct: set ? set.size : nonBlank,
      distinctApprox: distinctApprox[c],
      sample: acc.sample,
      issues,
      score,
      numeric,
      top,
    })
  }

  const totalCells = n * width
  const colScore = width > 0 ? scoreSum / width : 100
  const dupRate = n > 0 ? duplicateRows / n : 0
  const score = Math.max(0, Math.round(colScore - Math.min(20, dupRate * 100 * 0.8)))

  const notes: string[] = []
  if (!checkDup) notes.push(`行数超过 ${DUP_SCAN_LIMIT.toLocaleString()}，已跳过重复行检测`)
  if (accs.some((a) => a.resTotal > RESERVOIR)) {
    notes.push('数据量较大，分位数/异常值基于蓄水池抽样估算')
  }
  if (anyWhitespace > 0) notes.push('检测到多余空格，可用「清理空格」一键处理')

  return {
    id: opts.id ?? makeId(),
    name,
    sheet,
    columns,
    rows,
    meta: {
      rowCount: n,
      colCount: width,
      missingCells,
      totalCells,
      duplicateRows,
      duplicateRowsChecked: checkDup,
      score,
      elapsedMs: opts.elapsedMs ?? 0,
      source: opts.source ?? '',
      notes,
    },
  }
}

/** 从原始二维表构建数据集（自动找表头） */
export function buildDataset(
  name: string,
  sheet: string,
  rawRows: CellValue[][],
  opts: { source?: string; elapsedMs?: number } = {},
): Dataset {
  const headerIdx = findHeaderRow(rawRows)
  const headerRow = rawRows[headerIdx] ?? []
  const body = rawRows.slice(headerIdx + 1)

  // 表头宽度：去掉尾部空表头，表头全空时用首行数据宽度兜底
  let width = headerRow.length
  while (width > 0 && isBlank(headerRow[width - 1])) width--
  if (width === 0 && body.length > 0) {
    for (const row of body.slice(0, 20)) width = Math.max(width, row.length)
  }

  const headers = sanitizeHeaders(headerRow, width)
  const trimmedBody = body.filter((row) => row.some((c) => !isBlank(c)))
  return profileRows(name, sheet, headers, trimmedBody, opts)
}

/** 清洗之后重算体检，列名保持不变 */
export function rebuildDataset(
  prev: Dataset,
  rows: CellValue[][],
  opts: { elapsedMs?: number } = {},
): Dataset {
  const headers = prev.columns.map((c) => c.name)
  return profileRows(prev.name, prev.sheet, headers, rows, {
    id: prev.id,
    source: prev.meta.source,
    elapsedMs: opts.elapsedMs,
  })
}

export function overallMissingRate(ds: Dataset): number {
  return ds.meta.totalCells > 0 ? ds.meta.missingCells / ds.meta.totalCells : 0
}

import type { CellValue, Column } from './types'
import { coerceNumber, isBlank, rawText } from './value'

export interface OpResult {
  rows: CellValue[][]
  affected: number
  detail: string
  /** 过滤类算子返回保留下来的行下标（按原顺序），值类算子不返回 */
  kept?: number[]
}

/**
 * 所有算子都是「写时复制」：
 * 只有真正被改动的行才复制一份新数组，其余行保持原对象引用。
 * 这样原始数据（baseline）永远不会被破坏，撤销只要重放即可，
 * 内存开销只和「改了多少」成正比，而不是和表有多大成正比。
 */

const EDGE_SPACE_RE = /^[\s\u00a0\u3000]+|[\s\u00a0\u3000]+$/g

export function opTrimWhitespace(rows: CellValue[][], columns: Column[]): OpResult {
  const next = rows.slice()
  let affected = 0
  for (let r = 0; r < next.length; r++) {
    const row = next[r]
    let copy: CellValue[] | null = null
    for (const col of columns) {
      const v = row[col.index]
      if (typeof v !== 'string') continue
      const trimmed = v.replace(EDGE_SPACE_RE, '')
      if (trimmed === v) continue
      if (!copy) copy = row.slice()
      copy[col.index] = trimmed
      affected++
    }
    if (copy) next[r] = copy
  }
  return { rows: next, affected, detail: `清理了 ${affected} 个单元格的首尾空格` }
}

export type FillStrategy = 'mean' | 'median' | 'mode' | 'zero' | 'text'

export const FILL_LABEL: Record<FillStrategy, string> = {
  mean: '用平均值填充',
  median: '用中位数填充',
  mode: '用出现最多的值填充',
  zero: '填 0',
  text: '填「未填写」',
}

/** 把策略解析成具体填充值（在「当前状态」的列统计上算，然后记进操作里，重放才可复现） */
export function resolveFillValue(col: Column, strategy: FillStrategy, custom?: string): CellValue {
  switch (strategy) {
    case 'mean':
      return col.numeric && Number.isFinite(col.numeric.mean) ? col.numeric.mean : null
    case 'median':
      return col.numeric && Number.isFinite(col.numeric.median) ? col.numeric.median : null
    case 'zero':
      return 0
    case 'mode':
      return col.top.length > 0 ? col.top[0].value : null
    case 'text':
      return custom && custom.length > 0 ? custom : '未填写'
  }
}

export function opFillMissing(
  rows: CellValue[][],
  colIndex: number,
  colName: string,
  value: CellValue,
): OpResult {
  if (value === null || value === undefined) {
    return { rows, affected: 0, detail: '没有可用的填充值' }
  }
  const next = rows.slice()
  let affected = 0
  for (let r = 0; r < next.length; r++) {
    const row = next[r]
    if (!isBlank(row[colIndex])) continue
    const copy = row.slice()
    copy[colIndex] = value
    next[r] = copy
    affected++
  }
  return {
    rows: next,
    affected,
    detail:
      affected === 0
        ? `「${colName}」没有空值`
        : `「${colName}」填充了 ${affected} 个空单元格 → ${rawText(value)}`,
  }
}

export function opDropDuplicateRows(rows: CellValue[][], columns: Column[]): OpResult {
  const seen = new Set<string>()
  const kept: CellValue[][] = []
  const keptIdx: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    let key = ''
    for (const col of columns) {
      key += rawText(row[col.index] ?? null)
      key += '\u0001'
    }
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(row)
    keptIdx.push(i)
  }
  const affected = rows.length - kept.length
  return {
    rows: kept,
    kept: keptIdx,
    affected,
    detail: `删除了 ${affected} 行完全重复的数据`,
  }
}

export function opDropEmptyRows(rows: CellValue[][]): OpResult {
  const kept: CellValue[][] = []
  const keptIdx: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((v) => !isBlank(v))) {
      kept.push(rows[i])
      keptIdx.push(i)
    }
  }
  const affected = rows.length - kept.length
  return { rows: kept, kept: keptIdx, affected, detail: `删除了 ${affected} 行全空行` }
}

/** 把带千分位/全角字符的文本列转成真正的数字列 */
export function opNormalizeNumbers(rows: CellValue[][], colIndex: number, colName: string): OpResult {
  const next = rows.slice()
  let affected = 0
  for (let r = 0; r < next.length; r++) {
    const row = next[r]
    const v = row[colIndex]
    if (typeof v === 'number' || isBlank(v)) continue
    const n = coerceNumber(v)
    if (n === null) continue
    const copy = row.slice()
    copy[colIndex] = n
    next[r] = copy
    affected++
  }
  return { rows: next, affected, detail: `「${colName}」有 ${affected} 个值转成了数字` }
}

/* ------------------------------------------------------------------ *
 * 行筛选：只保留符合条件的行
 * ------------------------------------------------------------------ */

export type FilterOp = 'gt' | 'lt' | 'eq' | 'contains' | 'notContains'

export const FILTER_LABEL: Record<FilterOp, string> = {
  gt: '大于',
  lt: '小于',
  eq: '等于',
  contains: '包含',
  notContains: '不包含',
}

/** 单元格是否满足条件：数值比较优先，文本比较忽略大小写 */
function matchFilter(cell: CellValue, op: FilterOp, needle: string, needleNum: number | null): boolean {
  const text = rawText(cell).trim()

  if (op === 'contains') return text.toLowerCase().includes(needle.toLowerCase())
  if (op === 'notContains') return !text.toLowerCase().includes(needle.toLowerCase())

  if (op === 'eq') {
    if (needleNum !== null && !isBlank(cell)) {
      const v = coerceNumber(cell)
      if (v !== null) return v === needleNum
    }
    return text.toLowerCase() === needle.toLowerCase()
  }

  // 大于 / 小于：条件值是数字时只留能转成数字的单元格；
  // 条件值不是数字时按字符串序比较。空值在两种情况下都不保留。
  const v = isBlank(cell) ? null : coerceNumber(cell)
  if (needleNum !== null) return v !== null && (op === 'gt' ? v > needleNum : v < needleNum)
  if (text === '') return false
  return op === 'gt' ? text > needle : text < needle
}

/** 行筛选：保留满足条件的行，空单元格在「大于/小于」下会被过滤掉 */
export function opFilterRows(
  rows: CellValue[][],
  colIndex: number,
  colName: string,
  op: FilterOp,
  value: string,
): OpResult {
  const needle = value.trim()
  const needleNum = needle === '' ? null : coerceNumber(needle)
  const kept: CellValue[][] = []
  const keptIdx: number[] = []

  for (let i = 0; i < rows.length; i++) {
    if (matchFilter(rows[i][colIndex] ?? null, op, needle, needleNum)) {
      kept.push(rows[i])
      keptIdx.push(i)
    }
  }

  const removed = rows.length - kept.length
  return {
    rows: kept,
    kept: keptIdx,
    affected: removed,
    detail: `按「${colName}」${FILTER_LABEL[op]}「${needle}」筛选，保留 ${kept.length} 行、删除 ${removed} 行`,
  }
}

/* ------------------------------------------------------------------ *
 * 列操作：删列 / 调序 / 重命名（会改变列集合，所以要同时维护表头）
 * ------------------------------------------------------------------ */

export interface ColumnOpResult {
  rows: CellValue[][]
  headers: string[]
  affected: number
  detail: string
}

export function opDropColumn(rows: CellValue[][], headers: string[], colIndex: number): ColumnOpResult {
  const name = headers[colIndex] ?? ''
  const nextHeaders = headers.slice()
  nextHeaders.splice(colIndex, 1)
  const next = rows.map((row) => {
    const copy = row.slice()
    copy.splice(colIndex, 1)
    return copy
  })
  return {
    rows: next,
    headers: nextHeaders,
    affected: rows.length,
    detail: `删除了列「${name}」，剩余 ${nextHeaders.length} 列`,
  }
}

export function opMoveColumn(
  rows: CellValue[][],
  headers: string[],
  from: number,
  to: number,
): ColumnOpResult {
  const last = headers.length - 1
  const target = Math.max(0, Math.min(last, to))
  const name = headers[from] ?? ''
  if (from === target) {
    return { rows, headers, affected: 0, detail: `「${name}」已经在第 ${target + 1} 列` }
  }

  const nextHeaders = headers.slice()
  const [moved] = nextHeaders.splice(from, 1)
  nextHeaders.splice(target, 0, moved)

  const next = rows.map((row) => {
    const copy = row.slice()
    const [cell] = copy.splice(from, 1)
    copy.splice(target, 0, cell)
    return copy
  })

  return {
    rows: next,
    headers: nextHeaders,
    affected: rows.length,
    detail: `把「${name}」从第 ${from + 1} 列移到第 ${target + 1} 列`,
  }
}

export function opRenameColumn(headers: string[], colIndex: number, to: string): ColumnOpResult {
  const from = headers[colIndex] ?? ''
  const nextHeaders = headers.slice()
  nextHeaders[colIndex] = to
  return {
    rows: [],
    headers: nextHeaders,
    affected: 0,
    detail: `把列「${from}」重命名为「${to}」`,
  }
}


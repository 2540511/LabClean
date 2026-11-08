import type { CellValue, Column, Dataset } from './types'
import { coerceNumber } from './value'


/**
 * 智能推荐图表：导入数据后自动判断字段类型，按「数据场景 → 图表」规则产出最合适的可视化。
 *
 *   数值字段分布   → 直方图 / 箱线图     展示分布、识别离群点
 *   类别字段统计   → 柱状图 / 条形图     对比不同类别数量、占比
 *   带时间序列     → 折线图             展示随时间的变化趋势
 *   两个数值变量   → 散点图             观察相关性、识别偏差点
 *
 * 这一层是纯逻辑：只读列的体检元数据（type / distinct / numeric / top），不碰 DOM，可被 node 直接测试。
 */

/** 字段在可视化里能扮演的角色 */
export type FieldRole = 'measure' | 'category' | 'time' | 'id' | 'constant' | 'empty'

/** 推荐的图表类型 */
export type RecKind = 'histogram' | 'boxplot' | 'bar' | 'line' | 'scatter'

export const ROLE_LABEL: Record<FieldRole, string> = {
  measure: '数值度量',
  category: '类别',
  time: '时间序列',
  id: '编号/高基数',
  constant: '常量',
  empty: '空列',
}

export const KIND_LABEL: Record<RecKind, string> = {
  histogram: '直方图',
  boxplot: '箱线图',
  bar: '条形图',
  line: '折线图',
  scatter: '散点图',
}

/** 文本列唯一值不超过这个数才当「类别」，再多就画不下也不好看 */
const CATEGORY_MAX = 40
/** 唯一值占行数的比例超过这个，基本是编号 / 主键 / 自由文本，不参与类别统计 */
const ID_RATIO = 0.85

/** 列名像「编号 / 学号 / 序号」时，数值列也不该画分布图 */
const ID_NAME_RE =
  /(编号|学号|工号|序号|编码|代码|条码|单号)|(^|[^a-z])(id|no|sn|uuid|code|key)([^a-z]|$)/i

function isNumericId(col: Column): boolean {
  const s = col.numeric
  if (!s || col.type !== 'number') return false
  if (!Number.isInteger(s.min) || !Number.isInteger(s.max)) return false
  return ID_NAME_RE.test(col.name)
}

export interface FieldInfo {
  index: number
  name: string
  type: Column['type']
  role: FieldRole
  roleLabel: string
  distinct: number
  /** 是否能被推荐引擎拿来画图 */
  chartable: boolean
}

/** 单列角色判定：只依赖体检已经算好的元数据 */
export function classifyField(col: Column, rowCount: number): FieldRole {
  const nonBlank = rowCount - col.missing
  if (nonBlank <= 0) return 'empty'
  if (col.type === 'date') return 'time'
  if (col.distinct <= 1) return 'constant'
  if (col.type === 'boolean') return 'category'
  // 数值列：编号/学号这类整数值画分布没有意义，单独标成 id
  if (col.type === 'number') return isNumericId(col) ? 'id' : 'measure'
  // 文本列：低基数且不接近「每行都不同」才当类别；否则是编号/自由文本，画不出有意义的类别图
  const ratio = rowCount > 0 ? col.distinct / rowCount : 0
  if (col.distinct <= CATEGORY_MAX && ratio <= ID_RATIO) return 'category'
  return 'id'
}

export function isChartable(role: FieldRole): boolean {
  return role === 'measure' || role === 'category' || role === 'time'
}

/** 给整个数据集的字段做类型判定，用于界面上的「字段类型摘要」 */
export function classifyFields(ds: Dataset): FieldInfo[] {
  const rowCount = ds.meta.rowCount
  return ds.columns.map((col) => {
    const role = classifyField(col, rowCount)
    return {
      index: col.index,
      name: col.name,
      type: col.type,
      role,
      roleLabel: ROLE_LABEL[role],
      distinct: col.distinct,
      chartable: isChartable(role),
    }
  })
}

/**
 * 抽样估算两列的 |r|：散点图应该画「最相关」的一对，而不是按列顺序取前两列。
 * 大表只抽样（默认 4000 个点），只用于挑组合，不参与最终展示。
 */
function absCorrelation(
  rows: CellValue[][],
  xIndex: number,
  yIndex: number,
  skipRows?: Set<number>,
  sampleCap = 4000,
): number {
  const step = Math.max(1, Math.ceil(rows.length / sampleCap))
  let n = 0
  let sx = 0
  let sy = 0
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (let r = 0; r < rows.length; r += step) {
    if (skipRows?.has(r)) continue
    const x = coerceNumber(rows[r][xIndex] ?? null)
    const y = coerceNumber(rows[r][yIndex] ?? null)
    if (x === null || y === null) continue
    n++
    sx += x
    sy += y
    sxx += x * x
    syy += y * y
    sxy += x * y
  }
  if (n < 3) return 0
  const mx = sx / n
  const my = sy / n
  const vx = sxx / n - mx * mx
  const vy = syy / n - my * my
  if (vx <= 0 || vy <= 0) return 0
  return Math.abs((sxy / n - mx * my) / Math.sqrt(vx * vy))
}

export interface ChartPlan {
  id: string
  kind: RecKind
  /** 对应的数据场景（表格里那一列） */
  scenario: string
  /** 为什么推荐它（表格里「作用」那一列 + 命中的字段） */
  reason: string
  /** 主字段：直方图/箱线图/条形图的分析列，折线图的时间轴，散点图的 X */
  colIndex: number
  colName: string
  /** 次字段：折线图的数值列，散点图的 Y */
  secondIndex?: number
  secondName?: string
  /** 展示排序用（场景在表格里的先后） */
  rank: number
}

const SCENARIO = {
  numeric: '数值字段分布',
  category: '类别字段统计',
  time: '带时间序列的数据',
  relation: '两个数值变量关联',
} as const

/** 度量列的「值得先画」程度：有离群点的优先（箱线图最能体现），其次看基数 */
function measureScore(col: Column): number {
  const outliers = col.numeric?.outliers ?? 0
  return (outliers > 0 ? 1_000_000 : 0) + col.distinct
}

/**
 * 根据字段类型产出推荐图表清单。
 * 每类都做数量上限，避免一个宽表刷屏；命中不了的规则自动跳过。
 */
export function recommendCharts(ds: Dataset): ChartPlan[] {
  const rowCount = ds.meta.rowCount
  const skipRows =
    ds.meta.summaryRowIndexes && ds.meta.summaryRowIndexes.length > 0
      ? new Set(ds.meta.summaryRowIndexes)
      : undefined
  const plans: ChartPlan[] = []

  const measures = ds.columns
    .filter((c) => classifyField(c, rowCount) === 'measure' && c.numeric && c.numeric.n > 0)
    .sort((a, b) => measureScore(b) - measureScore(a))

  const categories = ds.columns
    .filter((c) => {
      const role = classifyField(c, rowCount)
      return role === 'category' && c.top.length > 0
    })
    .sort((a, b) => a.distinct - b.distinct)

  const times = ds.columns.filter((c) => classifyField(c, rowCount) === 'time')

  let seq = 0
  const push = (p: Omit<ChartPlan, 'id'>): void => {
    plans.push({ ...p, id: `rec_${seq++}` })
  }

  // ① 数值字段分布 → 直方图（最多 2 个度量列）
  for (const m of measures.slice(0, 2)) {
    push({
      kind: 'histogram',
      scenario: SCENARIO.numeric,
      reason: `「${m.name}」是数值度量，用直方图看整体分布形态（异常值单独成柱，不压扁坐标轴）`,
      colIndex: m.index,
      colName: m.name,
      rank: 1,
    })
  }

  // ② 数值字段分布 → 箱线图（只对存在离群点的度量列，最多 2 个）
  for (const m of measures.filter((c) => (c.numeric?.outliers ?? 0) > 0).slice(0, 2)) {
    push({
      kind: 'boxplot',
      scenario: SCENARIO.numeric,
      reason: `「${m.name}」检出 ${m.numeric?.outliers ?? 0} 个离群点，用箱线图看中位数/四分位并定位偏离值`,
      colIndex: m.index,
      colName: m.name,
      rank: 1,
    })
  }

  // ③ 类别字段统计 → 条形图（最多 2 个类别列）
  for (const c of categories.slice(0, 2)) {
    push({
      kind: 'bar',
      scenario: SCENARIO.category,
      reason: `「${c.name}」是类别字段（${c.distinct} 个取值），用条形图对比各类别的数量`,
      colIndex: c.index,
      colName: c.name,
      rank: 2,
    })
  }

  // ④ 带时间序列 → 折线图（时间轴 × 首要度量）
  if (times.length > 0 && measures.length > 0) {
    const t = times[0]
    const m = measures[0]
    push({
      kind: 'line',
      scenario: SCENARIO.time,
      reason: `以「${t.name}」为时间轴、「${m.name}」为数值，用折线图看随时间的变化趋势`,
      colIndex: t.index,
      colName: t.name,
      secondIndex: m.index,
      secondName: m.name,
      rank: 3,
    })
  }

  // ⑤ 两个数值变量关联 → 散点图：挑线性相关最强的一对，而不是「前两列」
  if (measures.length >= 2) {
    const pool = measures.slice(0, 4)
    let best: { x: Column; y: Column; r: number } | null = null
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const r = absCorrelation(ds.rows, pool[i].index, pool[j].index, skipRows)
        if (!best || r > best.r) best = { x: pool[i], y: pool[j], r }
      }
    }
    if (best) {
      push({
        kind: 'scatter',
        scenario: SCENARIO.relation,
        reason: `「${best.x.name}」与「${best.y.name}」的线性相关最强（|r|≈${best.r.toFixed(2)}），用散点图观察相关性、识别偏差点`,
        colIndex: best.x.index,
        colName: best.x.name,
        secondIndex: best.y.index,
        secondName: best.y.name,
        rank: 4,
      })
    }
  }

  return plans.sort((a, b) => a.rank - b.rank)
}

import type { CellValue, Column } from '../core/types'

export type BinKind = 'normal' | 'low' | 'high'

/**
 * 一列的「正常区间」：上下围栏夹在真实 min/max 之内。
 * 直方图只在这个区间里分箱，异常值单独成柱，才不会把坐标轴拉爆。
 */
export function normalRange(col: Column): [number, number] | null {
  const stats = col.numeric
  if (!stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max)) return null
  const lo = Number.isFinite(stats.lowFence) ? Math.max(stats.min, stats.lowFence) : stats.min
  const hi = Number.isFinite(stats.highFence) ? Math.min(stats.max, stats.highFence) : stats.max
  return [lo, Math.max(lo, hi)]
}

/** 直方图分箱设置：自动 / 指定组数 / 指定组距 */
export type HistSetting =
  | { mode: 'auto' }
  | { mode: 'count'; n: number }
  | { mode: 'width'; w: number }

export const DEFAULT_HIST: HistSetting = { mode: 'auto' }

/** 把设置换算成实际组数（组距模式下由区间宽度反推） */
export function resolveBinCount(
  setting: HistSetting,
  col: Column,
  rowCount: number,
): number {
  if (setting.mode === 'count') {
    return Math.max(2, Math.min(200, Math.round(setting.n)))
  }
  if (setting.mode === 'width') {
    const range = normalRange(col)
    if (!range || setting.w <= 0) {
      return Math.max(10, Math.min(40, Math.round(Math.sqrt(Math.max(rowCount, 1)))))
    }
    const n = Math.round((range[1] - range[0]) / setting.w)
    return Math.max(2, Math.min(200, n))
  }
  return Math.max(10, Math.min(40, Math.round(Math.sqrt(Math.max(rowCount, 1)))))
}

export interface HistBin {
  x0: number
  x1: number
  count: number
  kind: BinKind
}

export interface ColumnAnalysis {
  bins: HistBin[]
  points: number[]
  outlierRows: Set<number>
  outlierCount: number
  mean: number
  median: number
  /** 分箱所用区间的上下界（异常值被排除在这之外） */
  lowFence: number
  highFence: number
}

const MAX_POINTS = 600
const MAX_OUTLIER_ROWS = 50_000

function reservoirPush(arr: number[], value: number, seen: number): void {
  if (arr.length < MAX_POINTS) {
    arr.push(value)
    return
  }
  const j = Math.floor(Math.random() * seen)
  if (j < MAX_POINTS) arr[j] = value
}

/**
 * 单次遍历拿到：直方图分箱、抽样散点、异常值所在行。
 * 上百万行也只扫一遍，且不额外占用与行数成正比的内存。
 */
export function analyzeColumn(
  rows: CellValue[][],
  col: Column,
  binCountOverride?: number,
): ColumnAnalysis | null {
  const stats = col.numeric
  if (col.type !== 'number' || !stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max)) {
    return null
  }

  const min = stats.min
  const max = stats.max

  // 关键：分箱只覆盖「正常区间」（上下围栏之内），异常值单独归到两端。
  // 否则一个 999 之类的大值会把整个坐标轴拉长，正常数据全挤成一根柱子。
  const [lo, hi] = normalRange(col) ?? [min, max]
  const span = Math.max(hi - lo, 0)
  const binCount =
    binCountOverride && binCountOverride > 1
      ? Math.round(binCountOverride)
      : Math.max(10, Math.min(40, Math.round(Math.sqrt(Math.max(rows.length, 1)))))

  const bins: HistBin[] = []
  for (let i = 0; i < binCount; i++) {
    const x0 = lo + (span * i) / binCount
    const x1 = i === binCount - 1 ? hi : lo + (span * (i + 1)) / binCount
    bins.push({ x0, x1, count: 0, kind: 'normal' })
  }

  const outlierRows = new Set<number>()
  const points: number[] = []
  let seen = 0
  let lowCount = 0
  let highCount = 0
  let outlierCount = 0

  for (let r = 0; r < rows.length; r++) {
    const v = rows[r][col.index]
    if (typeof v !== 'number') continue
    seen++
    reservoirPush(points, v, seen)

    if (v < lo) {
      lowCount++
      outlierCount++
      if (outlierRows.size < MAX_OUTLIER_ROWS) outlierRows.add(r)
    } else if (v > hi) {
      highCount++
      outlierCount++
      if (outlierRows.size < MAX_OUTLIER_ROWS) outlierRows.add(r)
    } else {
      const k = span > 0 ? Math.min(binCount - 1, Math.floor(((v - lo) / span) * binCount)) : 0
      bins[k].count++
    }
  }

  const withEdges: HistBin[] = []
  if (lowCount > 0) withEdges.push({ x0: min, x1: lo, count: lowCount, kind: 'low' })
  withEdges.push(...bins)
  if (highCount > 0) withEdges.push({ x0: hi, x1: max, count: highCount, kind: 'high' })

  return {
    bins: withEdges,
    points,
    outlierRows,
    outlierCount,
    mean: stats.mean,
    median: stats.median,
    lowFence: lo,
    highFence: hi,
  }
}

export function classifySeverity(score: number): 'good' | 'warn' | 'bad' {
  if (score >= 85) return 'good'
  if (score >= 65) return 'warn'
  return 'bad'
}

/** 表格里「哪些列标红异常值」的四种范围 */
export type OutlierMode = 'current' | 'all' | 'none' | 'custom'

/** 判定「异常」的规则，用户可以改 */
export interface OutlierSettings {
  /** mad = 稳健 Z 分数（中位数 + MAD）；iqr = 四分位距 */
  method: 'mad' | 'iqr'
  /** mad 时是 Z 阈值（常用 3.5）；iqr 时是倍数（常用 1.5） */
  k: number
}

export const DEFAULT_OUTLIER_SETTINGS: OutlierSettings = { method: 'mad', k: 3.5 }

export const OUTLIER_K_RANGE: Record<OutlierSettings['method'], { min: number; max: number; step: number }> = {
  mad: { min: 1.5, max: 6, step: 0.1 },
  iqr: { min: 1, max: 3, step: 0.1 },
}

/**
 * 按当前设置算出某一列的异常上下界。
 *
 * 直接复用体检时存下的中位数 / MAD / 四分位数，**不需要重新扫表**，
 * 所以拖动阈值滑块能立刻在表格里看到变化。
 */
export function outlierFences(col: Column, settings: OutlierSettings): [number, number] | null {
  const s = col.numeric
  if (!s) return null
  const iqr = s.q3 - s.q1

  if (settings.method === 'iqr') {
    if (!(iqr > 0)) return null
    return [s.q1 - settings.k * iqr, s.q3 + settings.k * iqr]
  }

  // 稳健 Z：|x − median| / (MAD / 0.6745) > k
  if (s.mad > 0) {
    const span = (settings.k * s.mad) / 0.6745
    return [s.median - span, s.median + span]
  }
  // MAD 为 0（超过一半的值相同）时退到 IQR，和体检里的处理一致
  if (iqr > 0) return [s.q1 - 1.5 * iqr, s.q3 + 1.5 * iqr]
  return null
}

/** 判断单个单元格是不是异常值（按用户当前设置） */
export function isOutlierValue(
  v: CellValue,
  col: Column,
  settings: OutlierSettings = DEFAULT_OUTLIER_SETTINGS,
): boolean {
  if (typeof v !== 'number') return false
  const fences = outlierFences(col, settings)
  if (!fences) return false
  const [low, high] = fences
  return v < low || v > high
}

import type { CellValue, Column } from '../core/types'

export type BinKind = 'normal' | 'low' | 'high'

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
export function analyzeColumn(rows: CellValue[][], col: Column): ColumnAnalysis | null {
  const stats = col.numeric
  if (col.type !== 'number' || !stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max)) {
    return null
  }

  const min = stats.min
  const max = stats.max

  // 关键：分箱只覆盖「正常区间」（上下围栏之内），异常值单独归到两端。
  // 否则一个 999 之类的大值会把整个坐标轴拉长，正常数据全挤成一根柱子。
  const lo = Number.isFinite(stats.lowFence) ? Math.max(min, stats.lowFence) : min
  const hi = Number.isFinite(stats.highFence) ? Math.min(max, stats.highFence) : max
  const span = Math.max(hi - lo, 0)
  const binCount = Math.max(10, Math.min(40, Math.round(Math.sqrt(Math.max(rows.length, 1)))))

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

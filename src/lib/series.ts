import type { CellValue } from '../core/types'
import { coerceNumber, formatDate, parseDate } from '../core/value'

/**
 * 折线图 / 散点图需要真正读行数据（体检元数据里没有）。
 * 这里做单次遍历 + 抽样/聚合，保证大表也不会把界面卡住或把 ECharts 撑爆。
 */

export interface TimePoint {
  /** 时间轴上的时间戳（本地日 0 点），折线图用 time 轴时按它定位 */
  ts: number
  /** 时间轴标签（YYYY-MM-DD） */
  label: string
  /** 该时间点上数值列的均值，没有有效数值时为 null（折线会断开） */
  value: number | null
  /** 参与聚合的行数 */
  count: number
}

/** 把有序点降采样到 maxPoints 个：相邻若干点取均值，保留整体趋势形状 */
function downsampleAveraged(
  points: { ts: number; label: string; sum: number; count: number }[],
  maxPoints: number,
): { ts: number; label: string; sum: number; count: number }[] {
  if (points.length <= maxPoints) return points
  const bucketSize = Math.ceil(points.length / maxPoints)
  const out: { ts: number; label: string; sum: number; count: number }[] = []
  for (let i = 0; i < points.length; i += bucketSize) {
    const slice = points.slice(i, i + bucketSize)
    let sum = 0
    let count = 0
    for (const p of slice) {
      sum += p.sum
      count += p.count
    }
    out.push({ ts: slice[0].ts, label: slice[0].label, sum, count })
  }
  return out
}

/**
 * 时间序列：按「日期」聚合数值列的均值，按时间升序返回。
 * 同一天有多行时取均值；日期点数超过 maxPoints 时相邻聚合降采样。
 */
export function timeSeries(
  rows: CellValue[][],
  dateIndex: number,
  valueIndex: number,
  maxPoints = 160,
  skipRows?: Set<number>,
): TimePoint[] {
  const agg = new Map<number, { label: string; sum: number; count: number }>()
  for (let r = 0; r < rows.length; r++) {
    if (skipRows?.has(r)) continue
    const row = rows[r]
    const d = parseDate(row[dateIndex] ?? null)
    if (!d) continue
    // 按「本地日」聚合：key 必须是日，不能是原始时间戳 ——
    // 否则 08:00 和 20:00 会被当成两个点，而标签都截成同一天，x 轴出现重复刻度。
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const ts = day.getTime()
    let entry = agg.get(ts)
    if (!entry) {
      entry = { label: formatDate(day), sum: 0, count: 0 }
      agg.set(ts, entry)
    }
    const v = coerceNumber(row[valueIndex] ?? null)
    if (v !== null) {
      entry.sum += v
      entry.count++
    }
  }

  const ordered = [...agg.entries()]
    .map(([ts, e]) => ({ ts, label: e.label, sum: e.sum, count: e.count }))
    .sort((a, b) => a.ts - b.ts)

  return downsampleAveraged(ordered, maxPoints).map((p) => ({
    ts: p.ts,
    label: p.label,
    value: p.count > 0 ? p.sum / p.count : null,
    count: p.count,
  }))
}

export interface ScatterResult {
  /** 抽样后的点（最多 maxPoints 个），用于绘制 */
  points: [number, number][]
  /** Pearson 相关系数，范围 [-1, 1]；样本不足时为 NaN */
  r: number
  /** 最小二乘回归线：y = slope * x + intercept；无法拟合时为 null */
  line: { slope: number; intercept: number; x0: number; x1: number } | null
  /** 参与统计的有效点对总数 */
  n: number
}

/**
 * 两个数值变量的散点：一次遍历收集有效点对，抽样绘制，
 * 同时用全量点对算 Pearson 相关系数和回归线（相关性判断比抽样更准）。
 */
export function scatterSeries(
  rows: CellValue[][],
  xIndex: number,
  yIndex: number,
  maxPoints = 800,
  skipRows?: Set<number>,
): ScatterResult {
  const xs: number[] = []
  const ys: number[] = []
  for (let r = 0; r < rows.length; r++) {
    if (skipRows?.has(r)) continue
    const row = rows[r]
    const x = coerceNumber(row[xIndex] ?? null)
    const y = coerceNumber(row[yIndex] ?? null)
    if (x === null || y === null) continue
    xs.push(x)
    ys.push(y)
  }

  const n = xs.length
  const step = Math.max(1, Math.ceil(n / maxPoints))
  const points: [number, number][] = []
  for (let i = 0; i < n; i += step) points.push([xs[i], ys[i]])

  if (n < 2) return { points, r: NaN, line: null, n }

  let sumX = 0
  let sumY = 0
  for (let i = 0; i < n; i++) {
    sumX += xs[i]
    sumY += ys[i]
  }
  const meanX = sumX / n
  const meanY = sumY / n

  let cov = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX
    const dy = ys[i] - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }

  const r = varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : NaN
  let line: ScatterResult['line'] = null
  if (varX > 0) {
    const slope = cov / varX
    const intercept = meanY - slope * meanX
    let minX = Infinity
    let maxX = -Infinity
    for (let i = 0; i < n; i++) {
      if (xs[i] < minX) minX = xs[i]
      if (xs[i] > maxX) maxX = xs[i]
    }
    line = { slope, intercept, x0: minX, x1: maxX }
  }

  return { points, r, line, n }
}

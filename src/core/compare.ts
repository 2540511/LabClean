import type { Dataset } from './types'
import type { StepRecord } from './pipeline'
import { replay } from './pipeline'
import { rebuildDataset } from './profile'

/** 一个数据源：一份文件的某个工作表，带自己的清洗历史 */
export interface DataSource {
  id: string
  fileId: string
  name: string
  sheet: string
  sheetIndex: number
  size: number
  baseline: Dataset
  steps: StepRecord[]
  cursor: number
}

export interface SourceMetrics {
  id: string
  name: string
  sheet: string
  rows: number
  cols: number
  missingRate: number
  duplicateRate: number
  outlierRate: number
  score: number
  steps: number
  removedRows: number
  /** 主数值列的迷你分布，用来在卡片上画分面小图 */
  histogram: number[]
  histLabel: string
}

/** 重放后的当前数据；结果按「步骤指纹」缓存，切视图不会重复算 */
const datasetCache = new Map<string, Dataset>()

function fingerprint(source: DataSource): string {
  return `${source.id}|${source.steps
    .slice(0, source.cursor)
    .map((s) => s.id)
    .join(',')}`
}

export function resolveCurrent(source: DataSource): Dataset {
  const key = fingerprint(source)
  const hit = datasetCache.get(key)
  if (hit) return hit

  const applied = source.steps.slice(0, source.cursor)
  const ds =
    applied.length === 0
      ? source.baseline
      : rebuildDataset(
          source.baseline,
          replay(
            source.baseline.rows,
            source.baseline.columns,
            applied.map((s) => s.spec),
          ).rows,
        )
  datasetCache.set(key, ds)
  if (datasetCache.size > 120) datasetCache.clear()
  return ds
}

const BIN_COUNT = 14

/** 主数值列的迷你直方图（最多 14 个箱子） */
export function miniHistogram(ds: Dataset): { histogram: number[]; label: string } {
  const col = ds.columns.find((c) => c.type === 'number' && (c.numeric?.n ?? 0) > 1)
  const stats = col?.numeric
  if (!col || !stats || !Number.isFinite(stats.min) || !Number.isFinite(stats.max)) {
    return { histogram: [], label: '' }
  }

  const min = stats.min
  const max = stats.max
  const span = max - min
  const bins = new Array<number>(BIN_COUNT).fill(0)

  for (const row of ds.rows) {
    const v = row[col.index]
    if (typeof v !== 'number') continue
    const k = span > 0 ? Math.min(BIN_COUNT - 1, Math.floor(((v - min) / span) * BIN_COUNT)) : 0
    bins[k]++
  }
  return { histogram: bins, label: col.name }
}

export function sourceMetrics(source: DataSource): SourceMetrics {
  const ds = resolveCurrent(source)
  const numericValues = ds.columns.reduce((a, c) => a + (c.numeric?.n ?? 0), 0)
  const outliers = ds.columns.reduce((a, c) => a + (c.numeric?.outliers ?? 0), 0)
  const { histogram, label } = miniHistogram(ds)

  return {
    id: source.id,
    name: source.name,
    sheet: source.sheet,
    rows: ds.meta.rowCount,
    cols: ds.meta.colCount,
    missingRate: ds.meta.totalCells > 0 ? ds.meta.missingCells / ds.meta.totalCells : 0,
    duplicateRate:
      ds.meta.duplicateRowsChecked && ds.meta.rowCount > 0
        ? ds.meta.duplicateRows / ds.meta.rowCount
        : 0,
    outlierRate: numericValues > 0 ? outliers / numericValues : 0,
    score: ds.meta.score,
    steps: source.cursor,
    removedRows: Math.max(0, source.baseline.meta.rowCount - ds.meta.rowCount),
    histogram,
    histLabel: label,
  }
}

export type CellValue = string | number | boolean | Date | null

export type ColumnType = 'number' | 'date' | 'text' | 'boolean'

export type IssueSeverity = 'error' | 'warn' | 'info'

export type IssueCode =
  | 'EMPTY_COLUMN'
  | 'MISSING'
  | 'OUTLIER'
  | 'MIXED_TYPE'
  | 'WHITESPACE'
  | 'CONSTANT'
  | 'LEADING_ZERO'
  | 'THOUSANDS_SEP'
  | 'DUPLICATE_HEADER'

export interface ColumnIssue {
  code: IssueCode
  severity: IssueSeverity
  count: number
  message: string
}

/** 稳健统计：中位数 + MAD，避免极端值把阈值拉爆 */
export interface NumericStats {
  n: number
  min: number
  max: number
  mean: number
  std: number
  median: number
  q1: number
  q3: number
  mad: number
  lowFence: number
  highFence: number
  outliers: number
  outliersLow: number
  outliersHigh: number
  exact: boolean
}

export interface Column {
  key: string
  name: string
  index: number
  type: ColumnType
  missing: number
  missingRate: number
  distinct: number
  distinctApprox: boolean
  sample: string[]
  issues: ColumnIssue[]
  score: number
  numeric?: NumericStats
  top: { value: string; count: number }[]
}

export interface DatasetMeta {
  rowCount: number
  colCount: number
  missingCells: number
  totalCells: number
  duplicateRows: number
  duplicateRowsChecked: boolean
  score: number
  elapsedMs: number
  source: string
  notes: string[]
}

export interface Dataset {
  id: string
  name: string
  sheet: string
  columns: Column[]
  rows: CellValue[][]
  meta: DatasetMeta
}

export interface OpLogEntry {
  id: string
  at: number
  title: string
  detail: string
  affected: number
}

export interface SheetInfo {
  name: string
  rowCount: number
  colCount: number
}

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
  /** 合计/统计行或列：本身是对的，只是不该参与异常值判定 */
  | 'SUMMARY_ROW'

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
  /** 这一列是合计/统计列（如「总分」「合计」），不参与异常值判定 */
  summary?: boolean
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
  /** 公式单元格里没有保存计算结果的数量（导入后这些格子是空的） */
  formulaOnly?: number
  /** 识别到的合计/统计行数（这些行不参与异常值判定） */
  summaryRows?: number
  /** 合计/统计行的行下标（当前数据里的 0 基下标） */
  summaryRowIndexes?: number[]
  /** 整张表就是统计汇总表（统计项 / 结果），不做异常值判定 */
  summarySheet?: boolean
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

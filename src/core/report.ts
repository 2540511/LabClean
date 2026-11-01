import type { ColumnType, Dataset, OpLogEntry } from './types'
import type { ExportSheet } from './xlsx-io'
import { formatCell, toExportValue } from './value'

const TYPE_LABEL: Record<ColumnType, string> = {
  number: '数值',
  text: '文本',
  date: '日期',
  boolean: '布尔',
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`
}

function timeText(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 一个工作簿导出四张表：数据、体检报告、数据摘要、操作日志 */
export function buildReportSheets(ds: Dataset, logs: OpLogEntry[]): ExportSheet[] {
  const dataAoa: (string | number | boolean | Date | null)[][] = [
    ds.columns.map((c) => c.name),
  ]
  for (const row of ds.rows) {
    const out: (string | number | boolean | Date | null)[] = new Array(ds.columns.length)
    for (let c = 0; c < ds.columns.length; c++) out[c] = toExportValue(row[c] ?? null)
    dataAoa.push(out)
  }

  const reportAoa: (string | number | boolean | Date | null)[][] = [
    [
      '列名',
      '类型',
      '非空数量',
      '缺失数量',
      '缺失率',
      '唯一值',
      '异常值',
      '中位数',
      '平均值',
      '标准差',
      '最小值',
      '最大值',
      '质量分',
      '发现的问题',
    ],
  ]
  for (const col of ds.columns) {
    const num = col.numeric
    reportAoa.push([
      col.name,
      TYPE_LABEL[col.type],
      ds.meta.rowCount - col.missing,
      col.missing,
      pct(col.missingRate),
      col.distinct,
      num ? num.outliers : '',
      num && Number.isFinite(num.median) ? num.median : '',
      num && Number.isFinite(num.mean) ? num.mean : '',
      num && Number.isFinite(num.std) ? num.std : '',
      num && Number.isFinite(num.min) ? num.min : '',
      num && Number.isFinite(num.max) ? num.max : '',
      col.score,
      col.issues.map((i) => i.message).join('；'),
    ])
  }

  const summaryAoa: (string | number | boolean | Date | null)[][] = [
    ['项目', '数值'],
    ['数据来源', ds.meta.source || ds.name],
    ['工作表', ds.sheet],
    ['数据行数', ds.meta.rowCount],
    ['字段数', ds.meta.colCount],
    ['单元格总数', ds.meta.totalCells],
    ['空单元格数', ds.meta.missingCells],
    ['整体缺失率', pct(ds.meta.totalCells > 0 ? ds.meta.missingCells / ds.meta.totalCells : 0)],
    ['完全重复行', ds.meta.duplicateRowsChecked ? ds.meta.duplicateRows : '未检测（数据过大）'],
    ['数据质量分', ds.meta.score],
    ['解析耗时(ms)', Math.round(ds.meta.elapsedMs)],
    ['导出时间', timeText(Date.now())],
    ['清洗步骤数', logs.length],
    ['备注', ds.meta.notes.join('；')],
  ]

  const logAoa: (string | number | boolean | Date | null)[][] = [['时间', '操作', '影响数量', '说明']]
  for (const log of logs) {
    logAoa.push([timeText(log.at), log.title, log.affected, log.detail])
  }
  if (logs.length === 0) {
    logAoa.push(['—', '未做清洗', 0, '数据按原始状态导出'])
  }

  return [
    { name: '清洗后数据', aoa: dataAoa },
    { name: '体检报告', aoa: reportAoa },
    { name: '数据摘要', aoa: summaryAoa },
    { name: '操作日志', aoa: logAoa },
  ]
}

/** 单独导出一张「问题清单」，方便交给别人复查 */
export function buildIssueSheet(ds: Dataset): ExportSheet {
  const aoa: (string | number | boolean | Date | null)[][] = [
    ['列名', '问题', '严重程度', '影响数量'],
  ]
  for (const col of ds.columns) {
    for (const issue of col.issues) {
      aoa.push([
        col.name,
        issue.message,
        issue.severity === 'error' ? '严重' : issue.severity === 'warn' ? '警告' : '提示',
        issue.count,
      ])
    }
  }
  return { name: '问题清单', aoa }
}

export function previewText(ds: Dataset, colIndex: number, rowIndex: number): string {
  const col = ds.columns[colIndex]
  if (!col) return ''
  return formatCell(ds.rows[rowIndex]?.[colIndex] ?? null, col.type)
}

export interface CompareItem {
  label: string
  dataset: Dataset
  /** 这个数据源已经应用的清洗步骤，导出时合并成一张「操作日志」 */
  logs?: OpLogEntry[]
  metrics: {
    sheet: string
    rows: number
    cols: number
    missingRate: number
    duplicateRate: number
    outlierRate: number
    score: number
    steps: number
    removedRows: number
  }
}

/** 多数据源导出：一张对比总表 + 每个数据源一张清洗后数据表 */
export function buildCompareSheets(items: CompareItem[]): ExportSheet[] {
  const total: (string | number | boolean | Date | null)[][] = [
    ['数据源', '工作表', '行数', '列数', '缺失率', '重复率', '异常率', '质量分', '清洗步数', '删除行数'],
  ]
  for (const item of items) {
    const m = item.metrics
    total.push([
      item.label,
      m.sheet,
      m.rows,
      m.cols,
      pct(m.missingRate),
      pct(m.duplicateRate),
      pct(m.outlierRate),
      m.score,
      m.steps,
      m.removedRows,
    ])
  }

  const sheets: ExportSheet[] = [{ name: '对比总表', aoa: total }]

  for (const item of items.slice(0, 10)) {
    const dataAoa: (string | number | boolean | Date | null)[][] = [
      item.dataset.columns.map((c) => c.name),
    ]
    for (const row of item.dataset.rows) {
      const out: (string | number | boolean | Date | null)[] = new Array(item.dataset.columns.length)
      for (let c = 0; c < item.dataset.columns.length; c++) out[c] = toExportValue(row[c] ?? null)
      dataAoa.push(out)
    }
    sheets.push({
      name: item.label.replace(/[\\/?*[\]:]/g, ' ').slice(0, 24) || '数据',
      aoa: dataAoa,
    })
  }

  // 每个数据源的清洗步骤合并成一张日志，报告里能看清「哪张表、哪一步、改了多少」
  const logAoa: (string | number | boolean | Date | null)[][] = [
    ['数据源', '时间', '操作', '影响数量', '说明'],
  ]
  let logRows = 0
  for (const item of items) {
    for (const log of item.logs ?? []) {
      logAoa.push([item.label, timeText(log.at), log.title, log.affected, log.detail])
      logRows++
    }
  }
  if (logRows === 0) {
    logAoa.push(['—', '—', '未做清洗', 0, '所有数据源都按原始状态导出'])
  }
  sheets.push({ name: '操作日志', aoa: logAoa })

  return sheets
}

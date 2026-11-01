import type { CellValue, ColumnType } from './types'

const NUMBER_RE = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const DATE_RE =
  /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
const TIME_ONLY_RE = /^\d{1,2}:\d{2}(:\d{2})?$/
const LEADING_ZERO_RE = /^[+-]?0\d+$/
const THOUSANDS_RE = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/

const TRUE_SET = new Set(['true', '是', '真', 'yes', 'y', 't'])
const FALSE_SET = new Set(['false', '否', '假', 'no', 'n', 'f'])

/** 单元格的原始识别结果，不做任何改写 */
export type RawKind =
  | 'empty'
  | 'number'
  | 'date'
  | 'boolean'
  | 'leadingZero'
  | 'thousands'
  | 'text'

export function isBlank(v: CellValue): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === 'string') return v.trim() === ''
  return false
}

export function rawText(v: CellValue): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) return formatDate(v)
  return String(v)
}

export function classify(v: CellValue): RawKind {
  if (isBlank(v)) return 'empty'
  if (v instanceof Date) return 'date'
  if (typeof v === 'boolean') return 'boolean'
  if (typeof v === 'number') return 'number'
  if (typeof v !== 'string') return 'text'

  const s = v.trim()
  if (s === '') return 'empty'
  // 16 位以上的整数超出 JS 安全整数范围（2^53），当数字处理会悄悄改掉末位
  if (/^[+-]?\d{16,}$/.test(s)) return 'text'
  if (NUMBER_RE.test(s)) return LEADING_ZERO_RE.test(s) ? 'leadingZero' : 'number'
  if (THOUSANDS_RE.test(s)) return 'thousands'
  if (DATE_RE.test(s)) return 'date'
  const lower = s.toLowerCase()
  if (TRUE_SET.has(lower) || FALSE_SET.has(lower)) return 'boolean'
  return 'text'
}

/** 把形如 "1,234.5" / " 12 " 的文本转成数字；失败返回 null */
export function coerceNumber(v: CellValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v !== 'string') return null
  const s = v.trim().replace(/[,\s，]/g, '')
  if (s === '' || !NUMBER_RE.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

export function parseDate(v: CellValue): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v !== 'string') return null
  const m = DATE_RE.exec(v.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(y, mo - 1, d, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0))
  return Number.isNaN(dt.getTime()) ? null : dt
}

export function parseBoolean(v: CellValue): boolean | null {
  if (typeof v === 'boolean') return v
  if (typeof v !== 'string') return null
  const lower = v.trim().toLowerCase()
  if (TRUE_SET.has(lower)) return true
  if (FALSE_SET.has(lower)) return false
  return null
}

export function isTimeOnlyText(v: CellValue): boolean {
  return typeof v === 'string' && TIME_ONLY_RE.test(v.trim())
}

function pad2(n: number): string {
  return n < 10 ? '0' + n : String(n)
}

export function formatDate(d: Date): string {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  return time === '00:00:00' ? date : `${date} ${time}`
}

export function formatNumber(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n)
  const abs = Math.abs(n)
  if (abs !== 0 && (abs < 1e-4 || abs >= 1e9)) return n.toExponential(3)
  return String(Number(n.toPrecision(8)))
}

export function formatCell(v: CellValue, type?: ColumnType): string {
  if (isBlank(v)) return ''
  if (v instanceof Date) return formatDate(v)
  if (typeof v === 'number') return formatNumber(v)
  if (typeof v === 'boolean') return v ? '是' : '否'
  const s = String(v)
  // 日期列里的文本原样显示，别自作聪明改写
  return type === 'date' ? s : s.trim()
}

/** 导出用：保持数值/日期原始类型，便于下游继续计算 */
export function toExportValue(v: CellValue): string | number | boolean | Date | null {
  if (isBlank(v)) return null
  return v
}

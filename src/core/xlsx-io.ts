import * as XLSX from 'xlsx'
import type { CellValue } from './types'
import type { RawSheet } from './profile'

/** Excel 存 15 位以上整数时会掉精度，这类单元格按文本读回来 */
function normalizeCell(v: unknown): CellValue {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return v
  if (typeof v === 'number') {
    if (Number.isInteger(v) && !Number.isSafeInteger(v)) return String(v)
    return v
  }
  if (typeof v === 'boolean') return v
  return String(v)
}

/**
 * 数一数「有公式、但没有缓存值」的单元格。
 *
 * Excel / WPS 保存时会把计算结果一起写进文件，读到的是值；
 * 而脚本或库生成的 xlsx（openpyxl、很多 AI 生成的表）往往只写公式不写结果，
 * 这种单元格 SheetJS 默认直接丢掉，必须开 sheetStubs 才能看见（t === 'z'）。
 * 不提醒的话用户会以为「这批数据本来就是空的」。
 */
export function countFormulaOnly(ws: XLSX.WorkSheet): number {
  let count = 0
  for (const key of Object.keys(ws)) {
    if (key.charCodeAt(0) === 33 /* '!' 开头的元数据 */) continue
    const cell = (ws as unknown as Record<string, XLSX.CellObject | undefined>)[key]
    if (cell && cell.t === 'z' && cell.f !== undefined) count++
  }
  return count
}

export function readWorkbook(buffer: ArrayBuffer): RawSheet[] {
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellDates: true,
    cellNF: false,
    cellText: false,
    // 保留「有格式/公式但没有值」的占位单元格，用来识别「公式没算」的工作表
    sheetStubs: true,
  })

  return wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name]
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: null,
      raw: true,
      blankrows: false,
    })
    const rows: CellValue[][] = aoa.map((row) => (row ?? []).map(normalizeCell))
    return { name, rows, formulaOnly: countFormulaOnly(ws) }
  }).filter((s) => s.rows.length > 0)
}

export interface ExportSheet {
  name: string
  aoa: (string | number | boolean | Date | null)[][]
}

const BAD_SHEET_CHARS = /[\\/?*[\]:]/g

function safeSheetName(name: string, used: Set<string>): string {
  let base = name.replace(BAD_SHEET_CHARS, ' ').trim() || 'Sheet'
  base = base.slice(0, 28)
  let candidate = base
  let i = 2
  while (used.has(candidate)) {
    candidate = `${base}_${i++}`
  }
  used.add(candidate)
  return candidate
}

export function buildWorkbook(sheets: ExportSheet[]): XLSX.WorkBook {
  const wb = XLSX.utils.book_new()
  const used = new Set<string>()

  for (const sheet of sheets) {
    // Excel 的 XML 不允许 0x00-0x08、0x0B、0x0C、0x0E-0x1F 这些控制字符，
    // 数据里一旦混进去，生成的文件打开就会提示「需要修复」，所以导出前统一剔掉
    const aoa = sheet.aoa.map((row) => row.map(cleanExportValue))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    // 根据内容估算列宽，避免打开就是一堆 ####
    const widths: { wch: number }[] = []
    for (let c = 0; c < (sheet.aoa[0]?.length ?? 0); c++) {
      let max = 6
      for (let r = 0; r < sheet.aoa.length; r++) {
        const cell = sheet.aoa[r][c]
        const len = cell === null || cell === undefined ? 0 : String(cell).length
        if (len > max) max = len
      }
      widths.push({ wch: Math.min(46, max + 2) })
    }
    ws['!cols'] = widths
    XLSX.utils.book_append_sheet(wb, ws, safeSheetName(sheet.name, used))
  }
  return wb
}

const INVALID_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g

function cleanExportValue(v: string | number | boolean | Date | null | undefined) {
  if (typeof v !== 'string') return v ?? null
  return INVALID_XML_CHARS.test(v) ? v.replace(INVALID_XML_CHARS, '') : v
}

export function workbookToBlob(wb: XLSX.WorkBook): Blob {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * 触发浏览器下载。
 *
 * 两个坑：
 * 1. `<a>` 点击后**不能立刻移除** —— 部分 Chromium 会把正在进行的 blob 下载取消掉；
 * 2. object URL 也不能 early revoke，大文件（几十 MB、上万行）还没写完就被吊销会失败。
 * 所以这里保留 10s 再移除、60s 再释放，并返回 URL 供上层做「手动保存」兜底入口。
 */
export function downloadBlob(blob: Blob, filename: string): string {
  const url = URL.createObjectURL(blob)

  // 老 Edge / IE 的专用接口，存在就直接用
  const legacy = (navigator as unknown as { msSaveOrOpenBlob?: (b: Blob, n: string) => void })
    .msSaveOrOpenBlob
  if (typeof legacy === 'function') {
    try {
      legacy.call(navigator, blob, filename)
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      return url
    } catch {
      // 落到标准路径
    }
  }

  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()

  window.setTimeout(() => a.remove(), 10_000)
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return url
}

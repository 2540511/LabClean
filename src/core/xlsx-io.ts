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

export function readWorkbook(buffer: ArrayBuffer): RawSheet[] {
  const wb = XLSX.read(new Uint8Array(buffer), {
    type: 'array',
    cellDates: true,
    cellNF: false,
    cellText: false,
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
    return { name, rows }
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
    const ws = XLSX.utils.aoa_to_sheet(sheet.aoa)
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

export function workbookToBlob(wb: XLSX.WorkBook): Blob {
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true })
  return new Blob([out], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

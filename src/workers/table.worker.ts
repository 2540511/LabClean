/**
 * 解析与体检全部放在 Worker 里跑：
 * 主线程只管渲染，大文件也不会把界面卡成白屏。
 */
import { parseCsv, stripBom } from '../core/csv'
import { decodeText } from '../core/encoding'
import { buildDataset, type RawSheet } from '../core/profile'
import type { Dataset, SheetInfo } from '../core/types'
import { readWorkbook } from '../core/xlsx-io'

interface Scope {
  onmessage: ((e: MessageEvent) => void) | null
  postMessage(msg: unknown): void
}

/**
 * 用函数取 self 而不是模块级常量：这样在 Node 里跑冒烟测试时，
 * 先给 globalThis 挂上 self / postMessage 再加载本模块就能复用同一份代码。
 */
function scope(): Scope {
  return self as unknown as Scope
}

/** 缓存原始字节，切换工作表 / 重置时不用让用户重新选文件 */
const fileCache = new Map<string, Uint8Array>()

type Request =
  | { id: number; type: 'parse'; fileId: string; fileName: string; buffer: ArrayBuffer }
  | { id: number; type: 'sheet'; fileId: string; fileName: string; sheetIndex: number }
  | { id: number; type: 'release'; fileId: string }

type Response =
  | {
      id: number
      ok: true
      sheets: SheetInfo[]
      dataset: Dataset
      encoding?: string
      delimiter?: string
    }
  | { id: number; ok: true; released: boolean }
  | { id: number; ok: false; error: string }

const TEXT_EXT = /\.(csv|tsv|txt)$/i

function sheetInfos(sheets: RawSheet[]): SheetInfo[] {
  return sheets.map((s) => {
    let cols = 0
    for (const row of s.rows.slice(0, 5)) {
      let last = -1
      for (let i = 0; i < row.length; i++) if (row[i] !== null && String(row[i]).trim() !== '') last = i
      cols = Math.max(cols, last + 1)
    }
    return { name: s.name, rowCount: Math.max(0, s.rows.length - 1), colCount: cols }
  })
}

function loadSheets(
  fileName: string,
  bytes: Uint8Array,
): { sheets: RawSheet[]; encoding?: string; delimiter?: string } {
  if (TEXT_EXT.test(fileName)) {
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    const decoded = decodeText(buffer as ArrayBuffer)
    const text = stripBom(decoded.text)
    const rows = parseCsv(text)
    return {
      sheets: [{ name: '数据', rows }],
      encoding: decoded.encoding,
    }
  }
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  const sheets = readWorkbook(buffer as ArrayBuffer)
  if (sheets.length === 0) throw new Error('这个文件里没有可读的数据表')
  return { sheets }
}

function pickDefaultSheet(sheets: RawSheet[]): number {
  let best = 0
  let bestScore = -1
  sheets.forEach((s, i) => {
    const score = s.rows.length
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  })
  return best
}

function handleParse(req: Extract<Request, { type: 'parse' }>): Response {
  const started = performance.now()
  const bytes = new Uint8Array(req.buffer)
  fileCache.set(req.fileId, bytes)

  scope().postMessage({ type: 'progress', id: req.id, phase: '正在解析文件结构…' })
  const { sheets, encoding } = loadSheets(req.fileName, bytes)
  const infos = sheetInfos(sheets)

  const index = pickDefaultSheet(sheets)
  scope().postMessage({ type: 'progress', id: req.id, phase: '正在做数据体检…' })
  const raw = sheets[index]
  const dataset = buildDataset(req.fileName, raw.name, raw.rows, {
    source: req.fileName,
    elapsedMs: performance.now() - started,
    formulaOnly: raw.formulaOnly,
  })

  return { id: req.id, ok: true, sheets: infos, dataset, encoding }
}

function handleSheet(req: Extract<Request, { type: 'sheet' }>): Response {
  const started = performance.now()
  const bytes = fileCache.get(req.fileId)
  if (!bytes) throw new Error('文件缓存已失效，请重新导入')
  const { sheets } = loadSheets(req.fileName, bytes)
  const raw = sheets[req.sheetIndex]
  if (!raw) throw new Error('这个工作表不存在')
  const dataset = buildDataset(req.fileName, raw.name, raw.rows, {
    source: req.fileName,
    elapsedMs: performance.now() - started,
    formulaOnly: raw.formulaOnly,
  })
  return { id: req.id, ok: true, sheets: sheetInfos(sheets), dataset }
}

/** 真正的请求分发（导出是为了能在 Node 里跑冒烟测试） */
export function handleRequest(req: Request): Response {
  switch (req.type) {
    case 'parse':
      return handleParse(req)
    case 'sheet':
      return handleSheet(req)
    case 'release':
      return { id: req.id, ok: true, released: fileCache.delete(req.fileId) }
  }
}

const hasWorkerScope = typeof self !== 'undefined'

if (hasWorkerScope) {
  scope().onmessage = (event: MessageEvent) => {
    const req = event.data as Request
    try {
      scope().postMessage(handleRequest(req))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      scope().postMessage({ id: req.id, ok: false, error: message } satisfies Response)
    }
  }
}

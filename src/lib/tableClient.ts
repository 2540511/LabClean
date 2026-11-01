import type { Dataset, SheetInfo } from '../core/types'

export interface ParseResult {
  sheets: SheetInfo[]
  dataset: Dataset
  encoding?: string
}

type Resolver = {
  resolve: (value: ParseResult) => void
  reject: (err: Error) => void
  onProgress?: (phase: string) => void
}

/** 与解析 Worker 通信的极简封装：一个请求一个 Promise */
export class TableClient {
  private worker: Worker
  private seq = 0
  private pending = new Map<number, Resolver>()

  constructor() {
    // 用 URL 形式创建，Vite 会把它单独打成一个 chunk
    this.worker = new Worker(new URL('../workers/table.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (event: MessageEvent) => this.handle(event.data)
    this.worker.onerror = (event) => {
      const message = event.message || '解析线程异常'
      for (const [, r] of this.pending) r.reject(new Error(message))
      this.pending.clear()
    }
  }

  private handle(msg: unknown): void {
    const data = msg as {
      id?: number
      ok?: boolean
      error?: string
      phase?: string
      type?: string
      sheets?: SheetInfo[]
      dataset?: Dataset
      encoding?: string
    }
    if (data.type === 'progress') {
      if (data.id !== undefined) this.pending.get(data.id)?.onProgress?.(data.phase ?? '')
      return
    }
    if (data.id === undefined) return
    const resolver = this.pending.get(data.id)
    if (!resolver) return
    this.pending.delete(data.id)
    if (data.ok && data.dataset && data.sheets) {
      resolver.resolve({ sheets: data.sheets, dataset: data.dataset, encoding: data.encoding })
    } else {
      resolver.reject(new Error(data.error ?? '解析失败'))
    }
  }

  private request(payload: Record<string, unknown>, transfer?: Transferable[]): Promise<ParseResult> {
    const id = ++this.seq
    return new Promise<ParseResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({ ...payload, id }, transfer ?? [])
    })
  }

  parse(
    fileId: string,
    fileName: string,
    buffer: ArrayBuffer,
    onProgress?: (phase: string) => void,
  ): Promise<ParseResult> {
    const id = ++this.seq
    return new Promise<ParseResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress })
      this.worker.postMessage({ id, type: 'parse', fileId, fileName, buffer }, [buffer])
    })
  }

  loadSheet(fileId: string, fileName: string, sheetIndex: number): Promise<ParseResult> {
    return this.request({ type: 'sheet', fileId, fileName, sheetIndex })
  }

  dispose(): void {
    this.worker.terminate()
    this.pending.clear()
  }
}

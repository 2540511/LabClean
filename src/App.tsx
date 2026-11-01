import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartsDock } from './components/ChartsDock'
import { DataTable } from './components/DataTable'
import { EmptyState } from './components/EmptyState'
import { Inspector } from './components/Inspector'
import { Rail } from './components/Rail'
import type { FillStrategy, OpResult } from './core/clean'
import { opDropDuplicateRows, opDropEmptyRows, opFillMissing, opNormalizeNumbers, opTrimWhitespace } from './core/clean'
import { buildDemoDataset } from './core/demo'
import { rebuildDataset } from './core/profile'
import { buildReportSheets } from './core/report'
import type { Dataset, OpLogEntry, SheetInfo } from './core/types'
import { buildWorkbook, downloadBlob, workbookToBlob } from './core/xlsx-io'
import { analyzeColumn } from './lib/analyze'
import { bytes, nowStamp } from './lib/format'
import { TableClient } from './lib/tableClient'

const EMPTY_SET = new Set<number>()

/** 默认落到第一个有变化的数值列，打开页面就能看到图表，而不是看一列编号 */
function defaultColumnIndex(ds: Dataset): number {
  const idx = ds.columns.findIndex((c) => c.type === 'number' && c.distinct > 1)
  return idx >= 0 ? idx : 0
}

export default function App() {
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [sheets, setSheets] = useState<SheetInfo[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [file, setFile] = useState<{ id: string; name: string; size: number } | null>(null)
  const [encoding, setEncoding] = useState('')
  const [selected, setSelected] = useState(0)
  const [logs, setLogs] = useState<OpLogEntry[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const clientRef = useRef<TableClient | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const getClient = useCallback(() => {
    if (!clientRef.current) clientRef.current = new TableClient()
    return clientRef.current
  }, [])

  useEffect(() => () => clientRef.current?.dispose(), [])

  const importFile = useCallback(
    async (f: File) => {
      setError(null)
      setBusy('正在读取文件…')
      try {
        const buffer = await f.arrayBuffer()
        const id = `f_${Date.now().toString(36)}`
        const res = await getClient().parse(id, f.name, buffer, (phase) => setBusy(phase))
        setDataset(res.dataset)
        setSheets(res.sheets)
        setActiveSheet(Math.max(0, res.sheets.findIndex((s) => s.name === res.dataset.sheet)))
        setFile({ id, name: f.name, size: f.size })
        setEncoding(res.encoding ?? '')
        setSelected(defaultColumnIndex(res.dataset))
        setLogs([])
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [getClient],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const f = event.dataTransfer.files?.[0]
      if (f) void importFile(f)
    },
    [importFile],
  )

  const switchSheet = useCallback(
    async (index: number) => {
      if (!file || busy) return
      setBusy('正在切换工作表…')
      try {
        const res = await getClient().loadSheet(file.id, file.name, index)
        setDataset(res.dataset)
        setSheets(res.sheets)
        setActiveSheet(index)
        setSelected(defaultColumnIndex(res.dataset))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [busy, file, getClient],
  )

  const resetData = useCallback(async () => {
    if (!file || busy) return
    if (file.id === 'demo') {
      const demo = buildDemoDataset()
      setDataset(demo)
      setSelected(defaultColumnIndex(demo))
      setLogs([])
      return
    }
    setBusy('正在重新读取原文件…')
    try {
      const res = await getClient().loadSheet(file.id, file.name, activeSheet)
      setDataset(res.dataset)
      setSelected(defaultColumnIndex(res.dataset))
      setLogs([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [activeSheet, busy, file, getClient])

  const loadDemo = useCallback(() => {
    const demo = buildDemoDataset()
    setError(null)
    setDataset(demo)
    setSheets([{ name: demo.sheet, rowCount: demo.meta.rowCount, colCount: demo.meta.colCount }])
    setActiveSheet(0)
    setFile({ id: 'demo', name: demo.name, size: 0 })
    setEncoding('')
    setSelected(defaultColumnIndex(demo))
    setLogs([])
  }, [])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') loadDemo()
    // 只在首次挂载时判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyOp = useCallback(
    (title: string, run: (rows: Dataset['rows'], columns: Dataset['columns']) => OpResult) => {
      if (!dataset) return
      setBusy('正在重新体检…')
      window.setTimeout(() => {
        try {
          const started = performance.now()
          const result = run(dataset.rows, dataset.columns)
          const next = rebuildDataset(dataset, result.rows, {
            elapsedMs: performance.now() - started,
          })
          setDataset(next)
          setLogs((prev) => [
            {
              id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
              at: Date.now(),
              title,
              detail: result.detail,
              affected: result.affected,
            },
            ...prev,
          ])
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setBusy(null)
        }
      }, 30)
    },
    [dataset],
  )

  const exportExcel = useCallback(() => {
    if (!dataset) return
    if (dataset.meta.rowCount > 300_000) {
      const ok = window.confirm(
        `这次要导出 ${dataset.meta.rowCount.toLocaleString()} 行，生成 Excel 可能需要十几秒并占用较多内存，继续吗？`,
      )
      if (!ok) return
    }
    setBusy('正在生成 Excel…')
    window.setTimeout(() => {
      try {
        const wb = buildWorkbook(buildReportSheets(dataset, logs))
        const blob = workbookToBlob(wb)
        const base = (dataset.name || '数据').replace(/\.[^.]+$/, '')
        downloadBlob(blob, `${base}_清洗结果_${nowStamp()}.xlsx`)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    }, 40)
  }, [dataset, logs])

  const analysis = useMemo(() => {
    if (!dataset) return null
    const col = dataset.columns[selected]
    if (!col) return null
    return analyzeColumn(dataset.rows, col)
  }, [dataset, selected])

  const currentColumn = dataset?.columns[selected]

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        e.preventDefault()
        dragDepth.current++
        if (e.dataTransfer.types.includes('Files')) setDragging(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            LC
          </span>
          <div className="brand-text">
            <strong>LabClean</strong>
            <span>实验数据清洗机</span>
          </div>
        </div>

        {file ? (
          <div className="file-chip" title={file.name}>
            <span className="file-name">{file.name}</span>
            <span className="file-size">{bytes(file.size)}</span>
          </div>
        ) : (
          <div className="offline-badge">
            <span className="lock-dot" />
            纯本地处理 · 无网络请求
          </div>
        )}

        <div className="topbar-spacer" />

        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.txt"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void importFile(f)
            e.target.value = ''
          }}
        />
        <button className="btn" onClick={() => inputRef.current?.click()} disabled={!!busy}>
          导入文件
        </button>
        {dataset ? (
          <>
            <button className="btn" onClick={() => void resetData()} disabled={!!busy}>
              重置
            </button>
            <button className="btn btn-primary" onClick={exportExcel} disabled={!!busy}>
              导出 Excel
            </button>
          </>
        ) : null}
      </header>

      {dataset && currentColumn ? (
        <div className="body">
          <Rail
            dataset={dataset}
            sheets={sheets}
            activeSheet={activeSheet}
            onSheet={(i) => void switchSheet(i)}
            selected={selected}
            onSelect={setSelected}
          />

          <main className="main">
            <div className="kpis">
              <div className="kpi">
                <span>数据行数</span>
                <b>{dataset.meta.rowCount.toLocaleString()}</b>
              </div>
              <div className="kpi">
                <span>字段数</span>
                <b>{dataset.meta.colCount}</b>
              </div>
              <div className="kpi">
                <span>空单元格</span>
                <b>{dataset.meta.missingCells.toLocaleString()}</b>
              </div>
              <div className="kpi">
                <span>重复行</span>
                <b>{dataset.meta.duplicateRowsChecked ? dataset.meta.duplicateRows.toLocaleString() : '—'}</b>
              </div>
              <div className="kpi">
                <span>解析耗时</span>
                <b>{Math.round(dataset.meta.elapsedMs)} ms</b>
              </div>
            </div>

            <DataTable
              dataset={dataset}
              selected={selected}
              onSelect={setSelected}
              outlierRows={analysis?.outlierRows ?? EMPTY_SET}
            />

            <ChartsDock dataset={dataset} selected={selected} analysis={analysis} />
          </main>

          <Inspector
            dataset={dataset}
            column={currentColumn}
            logs={logs}
            busy={!!busy}
            onTrim={() => applyOp('清理首尾空格', (rows, cols) => opTrimWhitespace(rows, cols))}
            onDropEmpty={() => applyOp('删除全空行', (rows) => opDropEmptyRows(rows))}
            onDedupe={() => applyOp('删除重复行', (rows, cols) => opDropDuplicateRows(rows, cols))}
            onNormalizeNumbers={() =>
              applyOp('数字规范化', (rows) => opNormalizeNumbers(rows, currentColumn))
            }
            onFill={(strategy: FillStrategy, custom: string) =>
              applyOp(
                '填充缺失值',
                (rows) => opFillMissing(rows, currentColumn, strategy, custom),
              )
            }
          />
        </div>
      ) : (
        <EmptyState onPick={() => inputRef.current?.click()} onDemo={loadDemo} />
      )}

      <footer className="statusbar">
        <span className={busy ? 'status-busy' : 'status-idle'}>
          {busy ?? (dataset ? '就绪' : '等待导入数据')}
        </span>
        {dataset ? (
          <>
            <span className="sep" />
            <span>
              {dataset.name} · {dataset.sheet}
            </span>
            {encoding ? (
              <>
                <span className="sep" />
                <span>编码 {encoding}</span>
              </>
            ) : null}
            {dataset.meta.notes.length > 0 ? (
              <>
                <span className="sep" />
                <span className="tone-warn">{dataset.meta.notes.join('；')}</span>
              </>
            ) : null}
          </>
        ) : null}
        <span className="statusbar-spacer" />
        {logs.length > 0 ? <span>已执行 {logs.length} 步清洗</span> : <span>未做清洗</span>}
      </footer>

      {error ? (
        <div className="toast toast-error" role="alert">
          <div>
            <strong>处理失败</strong>
            <p>{error}</p>
          </div>
          <button className="btn btn-small" onClick={() => setError(null)}>
            知道了
          </button>
        </div>
      ) : null}

      {dragging ? (
        <div className="drop-overlay">
          <div className="drop-box">
            <strong>松手即导入</strong>
            <span>支持 .xlsx / .xls / .csv</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

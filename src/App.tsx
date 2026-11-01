import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartsDock } from './components/ChartsDock'
import { DataTable } from './components/DataTable'
import { EmptyState } from './components/EmptyState'
import { Inspector } from './components/Inspector'
import { Rail } from './components/Rail'
import { buildDemoDataset } from './core/demo'
import { resolveFillValue } from './core/clean'
import { applySpec, opTitle, replay, type OpSpec } from './core/pipeline'
import { rebuildDataset } from './core/profile'
import { buildReportSheets } from './core/report'
import type { Dataset, OpLogEntry, SheetInfo } from './core/types'
import { buildWorkbook, downloadBlob, workbookToBlob } from './core/xlsx-io'
import { analyzeColumn } from './lib/analyze'
import { computeDiff } from './lib/diff'
import { bytes, nowStamp } from './lib/format'
import { TableClient } from './lib/tableClient'

const EMPTY_SET = new Set<number>()

export interface Step {
  id: string
  at: number
  spec: OpSpec
  title: string
  detail: string
  affected: number
}

/** 默认落到第一个有变化的数值列，打开页面就能看到图表，而不是看一列编号 */
function defaultColumnIndex(ds: Dataset): number {
  const idx = ds.columns.findIndex((c) => c.type === 'number' && c.distinct > 1)
  return idx >= 0 ? idx : 0
}

function makeStepId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

export default function App() {
  /** 原始数据：只解析一次，之后永不修改（算子都是写时复制） */
  const [baseline, setBaseline] = useState<Dataset | null>(null)
  /** 全部步骤，含被撤销掉的 */
  const [steps, setSteps] = useState<Step[]>([])
  /** 已应用的步数：撤销就是减一，重做就是加一 */
  const [cursor, setCursor] = useState(0)

  const [sheets, setSheets] = useState<SheetInfo[]>([])
  const [activeSheet, setActiveSheet] = useState(0)
  const [file, setFile] = useState<{ id: string; name: string; size: number } | null>(null)
  const [encoding, setEncoding] = useState('')
  const [selected, setSelected] = useState(0)
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

  /** 派生状态：原始数据 + 重放前 cursor 步 = 当前数据 */
  const pipeline = useMemo(() => {
    if (!baseline) return null
    const applied = steps.slice(0, cursor)
    const out = replay(
      baseline.rows,
      baseline.columns,
      applied.map((s) => s.spec),
    )
    const dataset = applied.length === 0 ? baseline : rebuildDataset(baseline, out.rows)
    return { rows: out.rows, origins: out.origins, dataset }
  }, [baseline, steps, cursor])

  const dataset = pipeline?.dataset ?? null

  const diff = useMemo(() => {
    if (!baseline || !pipeline) return null
    if (pipeline.dataset === baseline) return { changedCells: 0, changedByColumn: [], removedRows: 0 }
    return computeDiff(baseline, pipeline.rows, pipeline.origins)
  }, [baseline, pipeline])

  const appliedSteps = useMemo(() => steps.slice(0, cursor), [steps, cursor])
  const logEntries: OpLogEntry[] = useMemo(
    () =>
      appliedSteps.map((s) => ({
        id: s.id,
        at: s.at,
        title: s.title,
        detail: s.detail,
        affected: s.affected,
      })),
    [appliedSteps],
  )

  const loadDataset = useCallback((ds: Dataset) => {
    setBaseline(ds)
    setSteps([])
    setCursor(0)
    setSelected(defaultColumnIndex(ds))
  }, [])

  const importFile = useCallback(
    async (f: File) => {
      setError(null)
      setBusy('正在读取文件…')
      try {
        const buffer = await f.arrayBuffer()
        const id = `f_${Date.now().toString(36)}`
        const res = await getClient().parse(id, f.name, buffer, (phase) => setBusy(phase))
        loadDataset(res.dataset)
        setSheets(res.sheets)
        setActiveSheet(Math.max(0, res.sheets.findIndex((s) => s.name === res.dataset.sheet)))
        setFile({ id, name: f.name, size: f.size })
        setEncoding(res.encoding ?? '')
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [getClient, loadDataset],
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
        loadDataset(res.dataset)
        setSheets(res.sheets)
        setActiveSheet(index)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [busy, file, getClient, loadDataset],
  )

  const reloadSource = useCallback(async () => {
    if (!file || busy) return
    if (file.id === 'demo') {
      loadDataset(buildDemoDataset())
      return
    }
    setBusy('正在重新读取原文件…')
    try {
      const res = await getClient().loadSheet(file.id, file.name, activeSheet)
      loadDataset(res.dataset)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [activeSheet, busy, file, getClient, loadDataset])

  const loadDemo = useCallback(() => {
    const demo = buildDemoDataset()
    setError(null)
    loadDataset(demo)
    setSheets([{ name: demo.sheet, rowCount: demo.meta.rowCount, colCount: demo.meta.colCount }])
    setActiveSheet(0)
    setFile({ id: 'demo', name: demo.name, size: 0 })
    setEncoding('')
  }, [loadDataset])

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('demo') === '1') loadDemo()
    // 只在首次挂载时判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 执行一步清洗：截断撤销历史后追加 */
  const runOp = useCallback(
    (spec: OpSpec) => {
      if (!pipeline || !baseline) return
      const out = applySpec(pipeline.rows, pipeline.origins, pipeline.dataset.columns, spec)
      const step: Step = {
        id: makeStepId(),
        at: Date.now(),
        spec,
        title: opTitle(spec),
        detail: out.detail,
        affected: out.affected,
      }
      setSteps((prev) => [...prev.slice(0, cursor), step])
      setCursor(cursor + 1)
    },
    [baseline, cursor, pipeline],
  )

  const undo = useCallback(() => setCursor((c) => Math.max(0, c - 1)), [])
  const redo = useCallback(() => setCursor((c) => Math.min(steps.length, c + 1)), [steps.length])

  /** 一次性跑多步（演示模式用）：在纯数据上顺序推演，避免依赖 React 状态的时序 */
  const runSequence = useCallback(
    (specs: OpSpec[]) => {
      if (!baseline) return
      let rows = baseline.rows
      let origins = baseline.rows.map((_, i) => i)
      const built: Step[] = []
      for (const spec of specs) {
        const out = applySpec(rows, origins, baseline.columns, spec)
        built.push({
          id: makeStepId(),
          at: Date.now(),
          spec,
          title: opTitle(spec),
          detail: out.detail,
          affected: out.affected,
        })
        rows = out.rows
        origins = out.origins
      }
      setSteps(built)
      setCursor(built.length)
    },
    [baseline],
  )

  /** ?demo=1&auto=1：自动演示一遍清洗流程，用于比赛演示和自检 */
  useEffect(() => {
    if (!baseline || steps.length > 0) return
    if (new URLSearchParams(window.location.search).get('auto') !== '1') return
    const idx = baseline.columns.findIndex((c) => c.type === 'number' && c.missing > 0)
    const col = baseline.columns[idx >= 0 ? idx : 1]
    const specs: OpSpec[] = [{ kind: 'trim' }]
    if (col) {
      specs.push({
        kind: 'fillMissing',
        colIndex: col.index,
        colName: col.name,
        strategy: 'median',
        value: resolveFillValue(col, 'median'),
      })
    }
    specs.push({ kind: 'dropDuplicates' })
    runSequence(specs)
  }, [baseline, runSequence, steps.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      const key = e.key.toLowerCase()
      if (key === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [redo, undo])

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
        const wb = buildWorkbook(buildReportSheets(dataset, logEntries))
        const blob = workbookToBlob(wb)
        const base = (dataset.name || '数据').replace(/\.[^.]+$/, '')
        downloadBlob(blob, `${base}_清洗结果_${nowStamp()}.xlsx`)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    }, 40)
  }, [dataset, logEntries])

  const analysis = useMemo(() => {
    if (!dataset) return null
    const col = dataset.columns[selected]
    if (!col) return null
    return analyzeColumn(dataset.rows, col)
  }, [dataset, selected])

  const compareSource = useMemo(() => {
    if (!baseline || !pipeline || baseline === pipeline.dataset) return null
    return { rows: baseline.rows, origins: pipeline.origins }
  }, [baseline, pipeline])

  const currentColumn = dataset?.columns[selected]
  const canUndo = cursor > 0
  const canRedo = cursor < steps.length

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
            <div className="history-group">
              <button
                className="btn btn-icon"
                onClick={undo}
                disabled={!canUndo || !!busy}
                title="撤销 (Ctrl+Z)"
              >
                ↶ 撤销
              </button>
              <button
                className="btn btn-icon"
                onClick={redo}
                disabled={!canRedo || !!busy}
                title="重做 (Ctrl+Shift+Z)"
              >
                ↷ 重做
              </button>
              <span className="history-count">
                {cursor}/{steps.length}
              </span>
            </div>
            <button className="btn" onClick={() => void reloadSource()} disabled={!!busy}>
              还原
            </button>
            <button className="btn btn-primary" onClick={exportExcel} disabled={!!busy}>
              导出 Excel
            </button>
          </>
        ) : null}
      </header>

      {dataset && currentColumn && pipeline ? (
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
                <span>已清洗</span>
                <b>{cursor > 0 ? `${cursor} 步` : '未清洗'}</b>
              </div>
            </div>

            <DataTable
              dataset={dataset}
              selected={selected}
              onSelect={setSelected}
              outlierRows={analysis?.outlierRows ?? EMPTY_SET}
              compare={compareSource}
            />

            <ChartsDock dataset={dataset} selected={selected} analysis={analysis} />
          </main>

          <Inspector
            dataset={dataset}
            baseline={baseline}
            column={currentColumn}
            steps={steps}
            cursor={cursor}
            diff={diff}
            busy={!!busy}
            canUndo={canUndo}
            canRedo={canRedo}
            onRun={runOp}
            onUndo={undo}
            onRedo={redo}
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
            {diff && diff.changedCells > 0 ? (
              <>
                <span className="sep" />
                <span className="tone-changed">已改动 {diff.changedCells.toLocaleString()} 个单元格</span>
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
        {cursor > 0 ? <span>已执行 {cursor} 步清洗 · Ctrl+Z 撤销</span> : <span>未做清洗</span>}
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

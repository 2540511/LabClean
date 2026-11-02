import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChartsDock } from './components/ChartsDock'
import { CompareView } from './components/CompareView'
import { DataTable } from './components/DataTable'
import { EmptyState } from './components/EmptyState'
import { FuzzyDialog } from './components/FuzzyDialog'
import { Inspector } from './components/Inspector'
import { Rail } from './components/Rail'
import { TemplateDialog, type ApplyScope } from './components/TemplateDialog'
import { resolveFillValue } from './core/clean'
import { resolveCurrent, sourceMetrics, type DataSource } from './core/compare'
import { buildDemoDatasets } from './core/demo'
import {
  applySpec,
  buildStepSequence,
  makeStepId,
  opTitle,
  replay,
  type OpSpec,
  type StepRecord,
} from './core/pipeline'
import { rebuildDataset } from './core/profile'
import { buildCompareSheets, buildReportSheets } from './core/report'
import {
  BUILTIN_TEMPLATES,
  loadTemplates,
  materializeSteps,
  persistTemplates,
  toTemplateSteps,
  type CleanTemplate,
} from './core/template'
import type { Dataset } from './core/types'
import { buildWorkbook, downloadBlob, releaseBlobUrl, workbookToBlob } from './core/xlsx-io'
import { analyzeColumn } from './lib/analyze'
import { computeDiff } from './lib/diff'
import { bytes, nowStamp } from './lib/format'
import { TableClient } from './lib/tableClient'

const EMPTY_SET = new Set<number>()

/** 单个文件最多导入几个工作表，避免一个几十表的工作簿把内存吃光 */
const MAX_SHEETS_PER_FILE = 6

/** 把异常整理成「能复制给人看」的一行 + 栈顶几行 */
function describeError(e: unknown): string {
  if (e instanceof Error) {
    const stack = (e.stack ?? '')
      .split('\n')
      .slice(1, 4)
      .map((l) => l.trim())
      .join('\n')
    return `${e.name}: ${e.message}${stack ? `\n${stack}` : ''}`
  }
  return String(e)
}

function defaultColumnIndex(ds: Dataset): number {
  const idx = ds.columns.findIndex((c) => c.type === 'number' && c.distinct > 1)
  return idx >= 0 ? idx : 0
}

function makeSource(
  fileId: string,
  meta: { name: string; size: number },
  sheetIndex: number,
  ds: Dataset,
): DataSource {
  return {
    id: `${fileId}#${sheetIndex}`,
    fileId,
    name: meta.name,
    sheet: ds.sheet,
    sheetIndex,
    size: meta.size,
    baseline: ds,
    steps: [],
    cursor: 0,
  }
}

export default function App() {
  const [sources, setSources] = useState<DataSource[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [view, setView] = useState<'table' | 'compare'>(() =>
    new URLSearchParams(window.location.search).get('view') === 'compare' ? 'compare' : 'table',
  )
  const [selected, setSelected] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 最近一次导出的文件：浏览器拦截自动下载时，用户可以点这个链接自己另存 */
  const [saved, setSaved] = useState<{ url: string; name: string } | null>(null)
  /** 记住当前 object URL，换新导出或关闭提示条时才释放（不能提前 revoke，否则「手动保存」会失效） */
  const savedUrlRef = useRef<string | null>(null)
  const showSaved = useCallback((url: string, name: string) => {
    releaseBlobUrl(savedUrlRef.current)
    savedUrlRef.current = url
    setSaved({ url, name })
  }, [])
  const closeSaved = useCallback(() => {
    releaseBlobUrl(savedUrlRef.current)
    savedUrlRef.current = null
    setSaved(null)
  }, [])
  useEffect(() => () => releaseBlobUrl(savedUrlRef.current), [])
  const [dragging, setDragging] = useState(false)
  const [encoding, setEncoding] = useState('')
  const [templates, setTemplates] = useState<CleanTemplate[]>(() => [
    ...BUILTIN_TEMPLATES,
    ...loadTemplates(),
  ])
  const [tplOpen, setTplOpen] = useState(false)
  const [fuzzyOpen, setFuzzyOpen] = useState(false)
  const [fuzzyAuto, setFuzzyAuto] = useState(false)

  const clientRef = useRef<TableClient | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const getClient = useCallback(() => {
    if (!clientRef.current) clientRef.current = new TableClient()
    return clientRef.current
  }, [])

  useEffect(() => () => clientRef.current?.dispose(), [])

  const active = useMemo(
    () => sources.find((s) => s.id === activeId) ?? sources[0] ?? null,
    [sources, activeId],
  )

  /** 原始数据 + 重放已应用的步骤 = 当前数据 */
  const pipeline = useMemo(() => {
    if (!active) return null
    const applied = active.steps.slice(0, active.cursor)
    const out = replay(
      active.baseline.rows,
      active.baseline.columns,
      applied.map((s) => s.spec),
    )
    const dataset =
      applied.length === 0
        ? active.baseline
        : rebuildDataset(active.baseline, out.rows, { headers: out.headers })
    return { rows: out.rows, origins: out.origins, headers: out.headers, dataset }
  }, [active])

  const dataset = pipeline?.dataset ?? null

  // 删列之后，选中的列下标可能越界，夹回有效范围
  useEffect(() => {
    if (!dataset || dataset.columns.length === 0) return
    if (selected > dataset.columns.length - 1) setSelected(dataset.columns.length - 1)
  }, [dataset, selected])

  const diff = useMemo(() => {
    if (!active || !pipeline) return null
    if (pipeline.dataset === active.baseline) {
      return { changedCells: 0, changedByColumn: [], removedRows: 0 }
    }
    return computeDiff(active.baseline, pipeline.rows, pipeline.origins, pipeline.headers)
  }, [active, pipeline])

  const patchActive = useCallback(
    (patch: (s: DataSource) => Partial<DataSource>) => {
      setSources((prev) => prev.map((s) => (s.id === activeId ? { ...s, ...patch(s) } : s)))
    },
    [activeId],
  )

  /** 切到另一个数据源时，默认选中它第一个有变化的数值列；URL 里指定了列名则优先 */
  useEffect(() => {
    if (!active) return
    const wanted = new URLSearchParams(window.location.search).get('col')
    if (wanted) {
      const idx = active.baseline.columns.findIndex((c) => c.name === wanted)
      if (idx >= 0) {
        setSelected(idx)
        return
      }
    }
    setSelected(defaultColumnIndex(active.baseline))
    // 只在切换数据源时重置
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id])

  // ---------- 导入 ----------
  const importFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setError(null)
      const added: DataSource[] = []
      try {
        for (const f of files) {
          setBusy(`正在读取 ${f.name}…`)
          const buffer = await f.arrayBuffer()
          const fileId = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
          const res = await getClient().parse(fileId, f.name, buffer, (phase) =>
            setBusy(`${f.name}：${phase}`),
          )
          setEncoding(res.encoding ?? '')

          const primaryIndex = Math.max(
            0,
            res.sheets.findIndex((s) => s.name === res.dataset.sheet),
          )
          added.push(makeSource(fileId, f, primaryIndex, res.dataset))

          // 其余工作表也作为独立数据源，方便横向对比
          const others = res.sheets
            .map((s, i) => ({ s, i }))
            .filter((x) => x.i !== primaryIndex)
            .slice(0, MAX_SHEETS_PER_FILE - 1)

          for (const o of others) {
            setBusy(`${f.name}：读取工作表「${o.s.name}」…`)
            try {
              const r = await getClient().loadSheet(fileId, f.name, o.i)
              added.push(makeSource(fileId, f, o.i, r.dataset))
            } catch {
              // 单个工作表读失败不影响其它数据源
            }
          }
        }

        const key = (s: DataSource) => `${s.name}#${s.sheet}`
        const seen = new Set(sources.map(key))
        const fresh = added.filter((s) => !seen.has(key(s)))
        if (fresh.length === 0) {
          setBusy(null)
          setError('这些数据源已经在列表里了')
          return
        }
        setSources((prev) => [...prev, ...fresh])
        setActiveId(fresh[0].id)
        setView('table')
      } catch (e) {
        setError(describeError(e))
      } finally {
        setBusy(null)
      }
    },
    [getClient, sources],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = Array.from(event.dataTransfer.files ?? [])
      if (files.length > 0) void importFiles(files)
    },
    [importFiles],
  )

  const loadDemo = useCallback(() => {
    const demos = buildDemoDatasets()
    const newSources = demos.map((d, i) => makeSource(`demo${i}`, { name: d.name, size: 0 }, 0, d))
    setError(null)
    setEncoding('')
    setSources((prev) => {
      const existing = new Set(prev.map((s) => s.id))
      return [...prev, ...newSources.filter((s) => !existing.has(s.id))]
    })
    setActiveId(newSources[0].id)
  }, [])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('demo') === '1') loadDemo()
    if (params.get('dialog') === 'templates') setTplOpen(true)
    if (params.get('dialog') === 'fuzzy') {
      setFuzzyOpen(true)
      setFuzzyAuto(params.get('autoscan') === '1')
    }
    // 只在首次挂载时判断一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const reloadSource = useCallback(async () => {
    if (!active || busy) return
    // 示例数据在内存里，直接清空步骤即可
    if (active.fileId.startsWith('demo')) {
      setSources((prev) =>
        prev.map((s) => (s.id === active.id ? { ...s, steps: [], cursor: 0 } : s)),
      )
      return
    }
    setBusy('正在重新读取原文件…')
    try {
      const res = await getClient().loadSheet(active.fileId, active.name, active.sheetIndex)
      setSources((prev) =>
        prev.map((s) => (s.id === active.id ? { ...s, baseline: res.dataset, steps: [], cursor: 0 } : s)),
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }, [active, busy, getClient, loadDemo])

  const removeSource = useCallback(
    (id: string) => {
      const next = sources.filter((s) => s.id !== id)
      setSources(next)
      if (activeId === id) setActiveId(next[0]?.id ?? null)
      if (next.length === 0) setView('table')
    },
    [activeId, sources],
  )

  // ---------- 清洗 ----------
  const runOp = useCallback(
    (spec: OpSpec) => {
      if (!active || !pipeline) return
      const out = applySpec(
        { rows: pipeline.rows, origins: pipeline.origins, headers: pipeline.headers },
        spec,
      )
      const step: StepRecord = {
        id: makeStepId(),
        at: Date.now(),
        spec,
        title: opTitle(spec),
        detail: out.detail,
        affected: out.affected,
      }
      patchActive((s) => ({ steps: [...s.steps.slice(0, s.cursor), step], cursor: s.cursor + 1 }))
    },
    [active, patchActive, pipeline],
  )

  const runSequence = useCallback(
    (specs: OpSpec[]) => {
      if (!active) return
      const { steps: built } = buildStepSequence(
        active.baseline.rows,
        active.baseline.columns,
        specs,
      )
      patchActive(() => ({ steps: built, cursor: built.length }))
    },
    [active, patchActive],
  )

  // ---------- 模板 ----------
  const saveTemplate = useCallback(
    (name: string) => {
      if (!active) return
      const applied = active.steps.slice(0, active.cursor)
      if (applied.length === 0) return
      const tpl: CleanTemplate = {
        id: `tpl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
        name,
        createdAt: Date.now(),
        steps: toTemplateSteps(
          applied.map((s) => s.spec),
          active.baseline.columns,
        ),
      }
      setTemplates((prev) => {
        const next = [tpl, ...prev]
        persistTemplates(next)
        return next
      })
    },
    [active],
  )

  const deleteTemplate = useCallback((id: string) => {
    setTemplates((prev) => {
      const next = prev.filter((t) => t.id !== id)
      persistTemplates(next)
      return next
    })
  }, [])

  const applyTemplate = useCallback(
    (id: string, scope: ApplyScope) => {
      const tpl = templates.find((t) => t.id === id)
      if (!tpl) return
      setSources((prev) =>
        prev.map((s) => {
          if (scope === 'active' && s.id !== activeId) return s
          const specs = materializeSteps(tpl.steps, s.baseline.columns)
          const { steps: built } = buildStepSequence(s.baseline.rows, s.baseline.columns, specs)
          return { ...s, steps: built, cursor: built.length }
        }),
      )
      setTplOpen(false)
    },
    [activeId, templates],
  )

  /** ?auto=1：自动演示一遍清洗流程（比赛演示 + 自检） */
  useEffect(() => {
    if (!active || active.steps.length > 0) return
    if (new URLSearchParams(window.location.search).get('auto') !== '1') return
    const idx = active.baseline.columns.findIndex((c) => c.type === 'number' && c.missing > 0)
    const col = active.baseline.columns[idx >= 0 ? idx : 1]
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
  }, [active, runSequence])

  const undo = useCallback(
    () => patchActive((s) => ({ cursor: Math.max(0, s.cursor - 1) })),
    [patchActive],
  )
  const redo = useCallback(
    () => patchActive((s) => ({ cursor: Math.min(s.steps.length, s.cursor + 1) })),
    [patchActive],
  )

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

  // ---------- 导出 ----------
  const logEntries = useMemo(() => {
    const applied = active ? active.steps.slice(0, active.cursor) : []
    return applied.map((s) => ({
      id: s.id,
      at: s.at,
      title: s.title,
      detail: s.detail,
      affected: s.affected,
    }))
  }, [active])

  const exportActive = useCallback(() => {
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
        const base = (dataset.name || '数据').replace(/\.[^.]+$/, '')
        const name = `${base}_清洗结果_${nowStamp()}.xlsx`
        showSaved(downloadBlob(workbookToBlob(wb), name), name)
      } catch (e) {
        setError(describeError(e))
      } finally {
        setBusy(null)
      }
    }, 40)
  }, [dataset, logEntries, showSaved])

  const exportAll = useCallback(() => {
    if (sources.length === 0) return
    setBusy('正在生成对比报告…')
    window.setTimeout(() => {
      try {
        const items = sources.map((s) => ({
          label: `${s.name.replace(/\.[^.]+$/, '')}${s.sheet ? `_${s.sheet}` : ''}`,
          dataset: resolveCurrent(s),
          metrics: sourceMetrics(s),
          logs: s.steps.slice(0, s.cursor).map((step) => ({
            id: step.id,
            at: step.at,
            title: step.title,
            detail: step.detail,
            affected: step.affected,
          })),
        }))
        const name = `数据对比_${nowStamp()}.xlsx`
        showSaved(downloadBlob(workbookToBlob(buildWorkbook(buildCompareSheets(items))), name), name)
      } catch (e) {
        setError(describeError(e))
      } finally {
        setBusy(null)
      }
    }, 40)
  }, [sources, showSaved])

  // ---------- 派生显示值 ----------
  const analysis = useMemo(() => {
    if (!dataset) return null
    const col = dataset.columns[selected]
    if (!col) return null
    return analyzeColumn(dataset.rows, col)
  }, [dataset, selected])

  const compareSource = useMemo(() => {
    if (!active || !pipeline || active.baseline === pipeline.dataset) return null
    // 列被删除/重排/改名后，「原值」悬浮提示会指错列，干脆关掉
    const sameLayout =
      pipeline.headers.length === active.baseline.columns.length &&
      pipeline.headers.every((h, i) => h === active.baseline.columns[i].name)
    if (!sameLayout) return null
    return { rows: active.baseline.rows, origins: pipeline.origins }
  }, [active, pipeline])

  const currentColumn = dataset?.columns[selected]
  const canUndo = !!active && active.cursor > 0
  const canRedo = !!active && active.cursor < active.steps.length
  const sourceName = active ? `${active.name}${sources.length > 1 ? ` · ${active.sheet}` : ''}` : ''

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

        {sources.length > 0 ? (
          <div className="view-switch" role="tablist">
            <button
              role="tab"
              className={view === 'table' ? 'vs-btn is-active' : 'vs-btn'}
              onClick={() => setView('table')}
            >
              单表清洗
            </button>
            <button
              role="tab"
              className={view === 'compare' ? 'vs-btn is-active' : 'vs-btn'}
              onClick={() => setView('compare')}
            >
              数据对比
              {sources.length > 1 ? <span className="vs-count">{sources.length}</span> : null}
            </button>
          </div>
        ) : null}

        {active ? (
          <div className="file-chip" title={sourceName}>
            <span className="file-name">{sourceName}</span>
            {active.size > 0 ? <span className="file-size">{bytes(active.size)}</span> : null}
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
          multiple
          hidden
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length > 0) void importFiles(files)
            e.target.value = ''
          }}
        />
        <button className="btn" onClick={() => inputRef.current?.click()} disabled={!!busy}>
          导入文件
        </button>

        {active && view === 'table' ? (
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
                {active.cursor}/{active.steps.length}
              </span>
            </div>
            <button className="btn" onClick={() => void reloadSource()} disabled={!!busy}>
              还原
            </button>
          </>
        ) : null}

        {sources.length > 1 ? (
          <button className="btn" onClick={exportAll} disabled={!!busy}>
            导出全部
          </button>
        ) : null}
        {active ? (
          <button className="btn btn-primary" onClick={exportActive} disabled={!!busy}>
            导出 Excel
          </button>
        ) : null}
      </header>

      {view === 'compare' && sources.length > 0 ? (
        <CompareView
          sources={sources}
          activeId={active?.id ?? null}
          onPick={(id) => {
            setActiveId(id)
            setView('table')
          }}
          onAdd={() => inputRef.current?.click()}
        />
      ) : dataset && currentColumn && active && pipeline ? (
        <div className="body">
          <Rail
            dataset={dataset}
            sources={sources}
            activeId={active.id}
            busy={!!busy}
            selected={selected}
            onSelect={setSelected}
            onSelectSource={setActiveId}
            onRemoveSource={removeSource}
            onAddSource={() => inputRef.current?.click()}
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
                <b>{active.cursor > 0 ? `${active.cursor} 步` : '未清洗'}</b>
              </div>
            </div>

            {dataset.meta.notes.length > 0 ? (
              <div className="notes" role="status">
                {dataset.meta.notes.map((note, i) => (
                  <div className="note" key={i}>
                    {note}
                  </div>
                ))}
              </div>
            ) : null}

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
            baseline={active.baseline}
            column={currentColumn}
            steps={active.steps}
            cursor={active.cursor}
            diff={diff}
            busy={!!busy}
            canUndo={canUndo}
            canRedo={canRedo}
            onRun={runOp}
            onUndo={undo}
            onRedo={redo}
            onOpenTemplates={() => setTplOpen(true)}
            onOpenFuzzy={() => setFuzzyOpen(true)}
          />
        </div>
      ) : (
        <EmptyState onPick={() => inputRef.current?.click()} onDemo={loadDemo} />
      )}

      <footer className="statusbar">
        <span className={busy ? 'status-busy' : 'status-idle'}>
          {busy ?? (dataset ? '就绪' : '等待导入数据')}
        </span>
        {sources.length > 0 ? (
          <>
            <span className="sep" />
            <span>
              {sources.length} 个数据源
              {active ? ` · 当前 ${active.name} · ${active.sheet}` : ''}
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
          </>
        ) : null}
        <span className="statusbar-spacer" />
        {active && active.cursor > 0 ? (
          <span>已执行 {active.cursor} 步清洗 · Ctrl+Z 撤销</span>
        ) : (
          <span>未做清洗</span>
        )}
      </footer>

      {fuzzyOpen && dataset && currentColumn ? (
        <FuzzyDialog
          open={fuzzyOpen}
          rows={dataset.rows}
          column={currentColumn}
          busy={!!busy}
          autoScan={fuzzyAuto}
          onClose={() => setFuzzyOpen(false)}
          onApply={(threshold, dropRows) => {
            runOp({
              kind: 'fuzzyDedupe',
              colIndex: currentColumn.index,
              colName: currentColumn.name,
              threshold,
              dropRows,
            })
            setFuzzyOpen(false)
          }}
        />
      ) : null}

      <TemplateDialog
        open={tplOpen}
        templates={templates}
        stepCount={active?.cursor ?? 0}
        sourceCount={sources.length}
        onClose={() => setTplOpen(false)}
        onSave={saveTemplate}
        onApply={applyTemplate}
        onDelete={deleteTemplate}
      />

      {saved ? (
        <div className="save-bar" role="status">
          <div>
            <strong>已生成 {saved.name}</strong>
            <p>如果浏览器没有自动开始下载（或被拦截），点右边按钮手动保存</p>
          </div>
          <a className="btn btn-small btn-primary" href={saved.url} download={saved.name}>
            手动保存
          </a>
          <button className="btn btn-small" onClick={closeSaved}>
            关闭
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="toast toast-error" role="alert">
          <div>
            <strong>处理失败</strong>
            <p className="err-text">{error}</p>
          </div>
          <button
            className="btn btn-small"
            onClick={() => {
              void navigator.clipboard?.writeText(error).catch(() => {})
            }}
          >
            复制详情
          </button>
          <button className="btn btn-small" onClick={() => setError(null)}>
            知道了
          </button>
        </div>
      ) : null}

      {dragging ? (
        <div className="drop-overlay">
          <div className="drop-box">
            <strong>松手即导入</strong>
            <span>支持多选 / 多个文件 / 多个工作表</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

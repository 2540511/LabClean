import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AiDiagnosisDialog } from './components/AiDiagnosisDialog'
import { ChartsDock } from './components/ChartsDock'
import { CompareView } from './components/CompareView'
import { DataTable } from './components/DataTable'
import { InsightsView } from './components/InsightsView'
import { EmptyState } from './components/EmptyState'
import { FuzzyDialog } from './components/FuzzyDialog'
import { Inspector } from './components/Inspector'
import { Rail } from './components/Rail'
import { SettingsDialog } from './components/SettingsDialog'
import { TemplateDialog, type ApplyScope } from './components/TemplateDialog'
import { resolveFillValue } from './core/clean'
import { releaseSourceCache, resolveCurrent, sourceMetrics, type DataSource } from './core/compare'
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
import {
  DEFAULT_HIST,
  DEFAULT_OUTLIER_SETTINGS,
  findColumnIssueRows,
  isOutlierValue,
  normalRange,
  resolveBinCount,
} from './lib/analyze'
import type { HistSetting, IssueRowKind, IssueRowSelection, OutlierMode, OutlierSettings } from './lib/analyze'
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
  const [view, setView] = useState<'table' | 'compare' | 'insights'>(() => {
    const v = new URLSearchParams(window.location.search).get('view')
    return v === 'compare' || v === 'insights' ? v : 'table'
  })
  const [selected, setSelected] = useState(0)
  /** 表格里手动点选的行（0 基下标），用于逐行删除 */
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set())
  /** 哪些列要把异常值标红：默认全部数值列，导入后一眼能看到异常 */
  const [outlierMode, setOutlierMode] = useState<OutlierMode>('all')
  const [customRedCols, setCustomRedCols] = useState<Set<number>>(new Set())
  /** 判定异常的规则，用户可以随时改 */
  const [outlierSettings, setOutlierSettings] = useState<OutlierSettings>(DEFAULT_OUTLIER_SETTINGS)
  /** 设置面板（异常标红 / 直方图分箱） */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 直方图分箱设置：自动 / 指定组数 / 指定组距 */
  const [hist, setHist] = useState<HistSetting>(DEFAULT_HIST)
  /** 点异常值列表后要高亮的行 */
  const [focusRow, setFocusRow] = useState<number | null>(null)
  /** 每次跳转加一：连点同一行也能重新滚过去 */
  const [focusSeq, setFocusSeq] = useState(0)
  const [activeIssue, setActiveIssue] = useState<IssueRowSelection | null>(null)
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
  const [aiOpen, setAiOpen] = useState(false)

  const clientRef = useRef<TableClient | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)

  const getClient = useCallback(() => {
    if (!clientRef.current) clientRef.current = new TableClient()
    return clientRef.current
  }, [])

  const releaseFile = useCallback((fileId: string) => {
    if (!fileId.startsWith('demo')) clientRef.current?.release(fileId)
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
      const parsedFileIds = new Set<string>()
      const retainedFileIds = new Set<string>()
      try {
        for (const f of files) {
          setBusy(`正在读取 ${f.name}…`)
          const buffer = await f.arrayBuffer()
          const fileId = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
          parsedFileIds.add(fileId)
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
        for (const source of fresh) retainedFileIds.add(source.fileId)
        if (fresh.length === 0) {
          setError('这些数据源已经在列表里了')
          return
        }
        setSources((prev) => [...prev, ...fresh])
        setActiveId(fresh[0].id)
        setView('table')
      } catch (e) {
        setError(describeError(e))
      } finally {
        for (const fileId of parsedFileIds) {
          if (!retainedFileIds.has(fileId)) releaseFile(fileId)
        }
        setBusy(null)
      }
    },
    [getClient, releaseFile, sources],
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
    if (params.get('settings') === '1') setSettingsOpen(true)
    // 演示/截图用：?bins=10 直接指定组数
    const binsParam = Number(params.get('bins'))
    if (Number.isFinite(binsParam) && binsParam >= 2) setHist({ mode: 'count', n: binsParam })
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
      const removed = sources.find((s) => s.id === id)
      const next = sources.filter((s) => s.id !== id)
      if (removed) {
        releaseSourceCache(id)
        if (!next.some((s) => s.fileId === removed.fileId)) releaseFile(removed.fileId)
      }
      setSources(next)
      if (activeId === id) setActiveId(next[0]?.id ?? null)
      if (next.length === 0) setView('table')
    },
    [activeId, releaseFile, sources],
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
        steps: toTemplateSteps(applied.map((s) => s.spec)),
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

  // ---------- 行选中 / 删除 ----------
  const toggleRow = useCallback((row: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev)
      if (next.has(row)) next.delete(row)
      else next.add(row)
      return next
    })
  }, [])

  const clearRows = useCallback(() => setSelectedRows(new Set()), [])

  /** 跳到某一行：表格滚过去并高亮 */
  const jumpToRow = useCallback((row: number) => {
    setFocusRow(row)
    setFocusSeq((n) => n + 1)
  }, [])

  const deleteSelectedRows = useCallback(() => {
    if (selectedRows.size === 0) return
    // 行号必须排序：重放时按这份下标删，顺序不影响结果，但日志读起来更清楚
    runOp({ kind: 'dropRows', indices: [...selectedRows].sort((a, b) => a - b) })
    setSelectedRows(new Set())
  }, [runOp, selectedRows])

  // 数据一变（任何清洗动作、撤销、切数据源），原来的行号就失效了，必须清空
  useEffect(() => {
    setSelectedRows(new Set())
    setFocusRow(null)
    setActiveIssue(null)
  }, [dataset])

  useEffect(() => {
    setActiveIssue(null)
  }, [selected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = !!target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)

      // 删除键：把选中的行删掉（可撤销）
      if (!typing && (e.key === 'Delete' || e.key === 'Backspace') && selectedRows.size > 0) {
        e.preventDefault()
        deleteSelectedRows()
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      if (typing) return
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
  }, [deleteSelectedRows, redo, selectedRows.size, undo])

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
  const currentColumn = dataset?.columns[selected] ?? null

  /** 按用户设置换算出的实际组数（自动模式下为 undefined，交给分析函数估算） */
  const binCount = useMemo(() => {
    if (!dataset || !currentColumn || hist.mode === 'auto') return undefined
    return resolveBinCount(hist, currentColumn, dataset.rows.length)
  }, [dataset, currentColumn, hist])

  const analysis = useMemo(() => {
    if (!dataset || !currentColumn) return null
    const summary = new Set<number>(dataset.meta.summaryRowIndexes ?? [])
    return analyzeColumn(dataset.rows, currentColumn, binCount, summary)
  }, [dataset, currentColumn, binCount])

  /** 自动模式下实际会用的组数（给设置面板显示） */
  const autoBinCount = useMemo(() => {
    if (!currentColumn || !dataset) return 10
    return resolveBinCount(DEFAULT_HIST, currentColumn, dataset.rows.length)
  }, [currentColumn, dataset])

  /** 正常区间和组距，写实验报告要用的数字 */
  const histRange = currentColumn ? normalRange(currentColumn) : null
  const effectiveBins = analysis ? analysis.bins.filter((b) => b.kind === 'normal').length : 0
  const binWidth =
    histRange && effectiveBins > 0
      ? (histRange[1] - histRange[0]) / effectiveBins
      : null

  /** 选中列里所有异常值所在的行（点一条可以跳过去） */
  const selectedOutliers = useMemo(() => {
    if (!dataset) return []
    const col = dataset.columns[selected]
    if (!col?.numeric) return []
    const summary = new Set<number>(dataset.meta.summaryRowIndexes ?? [])
    const out: { row: number; value: number }[] = []
    for (let r = 0; r < dataset.rows.length && out.length < 500; r++) {
      if (summary.has(r)) continue
      const v = dataset.rows[r][selected]
      if (typeof v === 'number' && isOutlierValue(v, col, outlierSettings)) {
        out.push({ row: r, value: v })
      }
    }
    return out
  }, [dataset, selected, outlierSettings])

  const issueRows = useMemo(() => {
    if (!dataset || !activeIssue) return []
    return findColumnIssueRows(
      dataset,
      activeIssue.columnIndex,
      activeIssue.kind,
      outlierSettings,
    )
  }, [dataset, activeIssue, outlierSettings])

  const issueHighlight = useMemo(
    () =>
      activeIssue
        ? { columnIndex: activeIssue.columnIndex, rows: new Set(issueRows) }
        : null,
    [activeIssue, issueRows],
  )

  const toggleIssue = useCallback(
    (kind: IssueRowKind) => {
      setActiveIssue((prev) =>
        prev?.columnIndex === selected && prev.kind === kind
          ? null
          : { columnIndex: selected, kind },
      )
    },
    [selected],
  )

  const selectColumnByName = useCallback(
    (name: string) => {
      if (!dataset) return
      const index = dataset.columns.findIndex((column) => column.name === name)
      if (index >= 0) setSelected(index)
    },
    [dataset],
  )

  /** 解析成「具体要标红的列下标集合」 */
  const redColumns = useMemo(() => {
    if (!dataset || outlierMode === 'none') return EMPTY_SET
    if (outlierMode === 'all') {
      const set = new Set<number>()
      dataset.columns.forEach((c, i) => {
        if (c.numeric) set.add(i)
      })
      return set
    }
    if (outlierMode === 'custom') return customRedCols
    return new Set([selected])
  }, [dataset, outlierMode, customRedCols, selected])

  /** 按当前设置统计异常值总数，让用户在弹层里立刻看到「阈值调小 → 变多」 */
  const outlierCount = useMemo(() => {
    if (!dataset || redColumns.size === 0) return 0
    if (dataset.rows.length > 500_000) return -1
    const summary = new Set<number>(dataset.meta.summaryRowIndexes ?? [])
    let total = 0
    for (const c of redColumns) {
      const col = dataset.columns[c]
      if (!col?.numeric) continue
      for (let r = 0; r < dataset.rows.length; r++) {
        if (summary.has(r)) continue
        if (isOutlierValue(dataset.rows[r][c] ?? null, col, outlierSettings)) total++
      }
    }
    return total
  }, [dataset, redColumns, outlierSettings])

  /** 点字段列表里的小红点：切换某一列是否标红，并自动进入「自定义」模式 */
  const toggleRedColumn = useCallback(
    (index: number) => {
      setCustomRedCols((prev) => {
        const base = outlierMode === 'custom' ? prev : new Set(redColumns)
        const next = new Set(base)
        if (next.has(index)) next.delete(index)
        else next.add(index)
        return next
      })
      setOutlierMode('custom')
    },
    [outlierMode, redColumns],
  )

  const compareSource = useMemo(() => {
    if (!active || !pipeline || active.baseline === pipeline.dataset) return null
    // 列被删除/重排/改名后，「原值」悬浮提示会指错列，干脆关掉
    const sameLayout =
      pipeline.headers.length === active.baseline.columns.length &&
      pipeline.headers.every((h, i) => h === active.baseline.columns[i].name)
    if (!sameLayout) return null
    return { rows: active.baseline.rows, origins: pipeline.origins }
  }, [active, pipeline])

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
            <button
              role="tab"
              className={view === 'insights' ? 'vs-btn is-active' : 'vs-btn'}
              onClick={() => setView('insights')}
            >
              智能图表
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
        <button className="btn" onClick={() => setSettingsOpen(true)} title="异常标红 / 直方图分箱">
          显示设置
        </button>
        {dataset ? (
          <button
            className="btn"
            onClick={() => setAiOpen(true)}
            title="只发送表结构与统计摘要，不发送数据行"
          >
            AI 诊断
          </button>
        ) : null}

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
      ) : view === 'insights' && dataset ? (
        <InsightsView dataset={dataset} />
      ) : dataset && currentColumn && active && pipeline ? (
        <div className="body">
          <Rail
            dataset={dataset}
            sources={sources}
            activeId={active.id}
            busy={!!busy}
            selected={selected}
            onSelect={setSelected}
            redColumns={redColumns}
            onToggleRedColumn={toggleRedColumn}
            outliers={selectedOutliers}
            onJumpRow={jumpToRow}
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
              redColumns={redColumns}
              outlierSettings={outlierSettings}
              focusRow={focusRow}
              focusSeq={focusSeq}
              issueHighlight={issueHighlight}
              compare={compareSource}
              selectedRows={selectedRows}
              onToggleRow={toggleRow}
              onClearRows={clearRows}
              onDeleteRows={deleteSelectedRows}
            />

            <ChartsDock dataset={dataset} selected={selected} analysis={analysis} />
          </main>

          <Inspector
            dataset={dataset}
            baseline={active.baseline}
            origins={pipeline.origins}
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
            onOpenAi={() => setAiOpen(true)}
            activeIssue={activeIssue}
            issueRows={issueRows}
            onToggleIssue={toggleIssue}
            onJumpRow={jumpToRow}
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

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        mode={outlierMode}
        onMode={setOutlierMode}
        settings={outlierSettings}
        onSettings={setOutlierSettings}
        outlierCount={outlierCount}
        redColumnCount={redColumns.size}
        hist={hist}
        onHist={setHist}
        effectiveBins={effectiveBins}
        autoBins={autoBinCount}
        binWidth={binWidth}
        histFrom={histRange?.[0] ?? null}
        histTo={histRange?.[1] ?? null}
      />

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

      <AiDiagnosisDialog
        open={aiOpen}
        dataset={dataset}
        onClose={() => setAiOpen(false)}
        onSelectColumn={selectColumnByName}
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

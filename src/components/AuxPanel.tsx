import { useMemo, useState } from 'react'
import type { Dataset } from '../core/types'
import type { StepRecord } from '../core/pipeline'
import type { DatasetDiff } from '../lib/diff'
import { buildCheckReport } from '../lib/checkReport'
import { int } from '../lib/format'
import { CompareOverlay } from './CompareOverlay'

interface Props {
  dataset: Dataset
  baseline: Dataset | null
  /** 当前每行来自原始数据的第几行 */
  origins: number[]
  steps: StepRecord[]
  cursor: number
  diff: DatasetDiff | null
  busy: boolean
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onOpenTemplates: () => void
}

/** 前后对比的一行：数值 + 变化量 */
function Delta({
  label,
  before,
  after,
  goodWhenDown = true,
}: {
  label: string
  before: number
  after: number
  goodWhenDown?: boolean
}) {
  const changed = before !== after
  const down = after < before
  const good = goodWhenDown ? down : !down
  return (
    <div className="delta-row">
      <span className="delta-label">{label}</span>
      <span className="delta-before">{int(before)}</span>
      <span className="delta-arrow">→</span>
      <span className="delta-after">{int(after)}</span>
      {changed ? (
        <span className={`delta-tag ${good ? 'is-good' : 'is-bad'}`}>
          {down ? '−' : '+'}
          {int(Math.abs(after - before))}
        </span>
      ) : (
        <span className="delta-tag is-flat">—</span>
      )}
    </div>
  )
}

function outliersOf(ds: Dataset): number {
  return ds.columns.reduce((a, c) => a + (c.numeric?.outliers ?? 0), 0)
}

/**
 * 辅助功能：清洗模板 / 清洗前后对比 / 校验报告。
 *
 * 和「行筛选 / 列操作」一样是可折叠面板：标题右侧的文字在「点击」和「收起」之间切换。
 */
export function AuxPanel({
  dataset,
  baseline,
  origins,
  steps,
  cursor,
  diff,
  busy,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenTemplates,
}: Props) {
  const [open, setOpen] = useState(false)
  const [cmpOpen, setCmpOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  const report = useMemo(
    () => buildCheckReport({ dataset, baseline, steps, cursor }),
    [dataset, baseline, steps, cursor],
  )

  const changedCols = diff ? diff.changedByColumn.filter((n) => n > 0).length : 0
  const hasChanges = !!baseline && !!diff && diff.changedCells + diff.removedRows > 0

  const copyReport = () => {
    const done = () => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
    const nav = navigator as Navigator & { clipboard?: Clipboard }
    if (nav.clipboard?.writeText) {
      nav.clipboard.writeText(report).then(done, () => {})
      return
    }
    // 老浏览器：退回临时 textarea
    const ta = document.createElement('textarea')
    ta.value = report
    document.body.appendChild(ta)
    ta.select()
    try {
      document.execCommand('copy')
      done()
    } catch {
      // 复制不了就算了，用户还能手动选中
    }
    ta.remove()
  }

  return (
    <details className="panel more-ops" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="panel-head">
        辅助功能
        <span className="panel-hint">{open ? '收起' : '点击'}</span>
      </summary>

      <div className="panel-body">
        {/* ① 清洗模板 */}
        <div className="ops-sub-title">清洗模板 · 一套规则重复用</div>
        <div className="actions">
          <button
            className="btn btn-ghost"
            onClick={onOpenTemplates}
            disabled={busy || cursor === 0}
            title={cursor === 0 ? '先做几步清洗再保存' : '把当前步骤按列名存成模板'}
          >
            保存为模板
          </button>
          <button className="btn btn-ghost" onClick={onOpenTemplates} disabled={busy}>
            套用模板…
          </button>
        </div>
        <div className="hint">
          {cursor === 0
            ? '先做几步清洗（比如 去重 → 过滤合计行 → 中位数填充），再把这一套存成模板'
            : `当前 ${cursor} 步会按列名存成模板，换一张同类型的表可以一键复用`}
        </div>

        {/* ② 清洗前后对比（原来的对比面板并入这里） */}
        <div className="ops-sub-title">
          清洗前后对比
          <span className="panel-hint">
            <button className="link-btn" disabled={!canUndo || busy} onClick={onUndo}>
              撤销
            </button>
            <button className="link-btn" disabled={!canRedo || busy} onClick={onRedo}>
              重做
            </button>
          </span>
        </div>
        {hasChanges && baseline && diff ? (
          <>
            <Delta label="行数" before={baseline.meta.rowCount} after={dataset.meta.rowCount} />
            <Delta
              label="空单元格"
              before={baseline.meta.missingCells}
              after={dataset.meta.missingCells}
            />
            <Delta
              label="重复行"
              before={baseline.meta.duplicateRows}
              after={dataset.meta.duplicateRows}
            />
            <Delta label="异常值" before={outliersOf(baseline)} after={outliersOf(dataset)} />
            <Delta
              label="质量分"
              before={baseline.meta.score}
              after={dataset.meta.score}
              goodWhenDown={false}
            />
            <div className="delta-foot">
              改动 <b>{int(diff.changedCells)}</b> 个单元格
              {changedCols > 0 ? `，涉及 ${changedCols} 列` : ''}
              {diff.removedRows > 0 ? `，删除 ${int(diff.removedRows)} 行` : ''}
            </div>
          </>
        ) : (
          <div className="log-empty">还没做清洗，做一步就会显示前后差异</div>
        )}
        <button
          className="btn btn-ghost block-btn"
          onClick={() => setCmpOpen(true)}
          disabled={!baseline}
        >
          左右分屏对比…
        </button>

        {/* ③ 校验报告 */}
        <div className="ops-sub-title aux-gap">
          校验报告
          <span className="panel-hint">
            <button className="link-btn" onClick={copyReport}>
              {copied ? '已复制 ✓' : '复制'}
            </button>
          </span>
        </div>
        <pre className="report-box">{report}</pre>
        <div className="hint">点「复制」就能整段粘到实验记录 / 答辩材料里</div>
      </div>

      <CompareOverlay
        open={cmpOpen}
        baseline={baseline}
        dataset={dataset}
        origins={origins}
        diff={diff}
        onClose={() => setCmpOpen(false)}
      />
    </details>
  )
}

import { useEffect, useMemo } from 'react'
import type { CellValue, Dataset } from '../core/types'
import { formatCell, isBlank } from '../core/value'
import type { DatasetDiff } from '../lib/diff'
import { int } from '../lib/format'

interface Props {
  open: boolean
  baseline: Dataset | null
  dataset: Dataset
  /** 当前每行来自原始数据的第几行 */
  origins: number[]
  diff: DatasetDiff | null
  onClose: () => void
}

/** 表格里最多铺多少行（再多多半也看不完，滚动反而卡） */
const MAX_ROWS = 300

function cellText(v: CellValue, type: Dataset['columns'][number]['type']): string {
  return isBlank(v) ? '∅' : String(formatCell(v, type))
}

/**
 * 清洗前后左右分屏对比。
 *
 * 左边是原始数据（被删掉的行标红），右边是清洗结果（改过的单元格标绿），
 * 两边都能独立滚动 —— 侧边栏太窄，所以放在弹层里看。
 */
export function CompareOverlay({ open, baseline, dataset, origins, diff, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // 当前列 → 原始列的下标（列被删/调序后按列名对齐）
  const sourceIndex = useMemo(() => {
    if (!baseline) return []
    return dataset.columns.map((c) => baseline.columns.findIndex((b) => b.name === c.name))
  }, [baseline, dataset])

  const kept = useMemo(() => new Set(origins), [origins])

  if (!open) return null

  const base = baseline ?? dataset
  const leftRows = base.rows.slice(0, MAX_ROWS)
  const rightRows = dataset.rows.slice(0, MAX_ROWS)
  const removed = Math.max(0, base.meta.rowCount - dataset.meta.rowCount)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide cmp-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="清洗前后对比"
      >
        <div className="modal-head">
          <strong>清洗前后对比</strong>
          <button className="modal-x" onClick={onClose} title="关闭 (Esc)">
            ×
          </button>
        </div>

        <div className="cmp-summary">
          <span>
            原始 <b>{int(base.meta.rowCount)}</b> 行
          </span>
          <span className="cmp-arrow">→</span>
          <span>
            清洗后 <b>{int(dataset.meta.rowCount)}</b> 行
          </span>
          <span className="cmp-sep">|</span>
          <span className="tone-bad">删除 {int(removed)} 行</span>
          <span className="cmp-sep">|</span>
          <span className="tone-good">改动 {int(diff?.changedCells ?? 0)} 格</span>
          <span className="cmp-sep">|</span>
          <span>
            空单元格 {int(base.meta.missingCells)} → {int(dataset.meta.missingCells)}
          </span>
        </div>

        <div className="cmp-grid">
          <div className="cmp-pane">
            <div className="cmp-pane-head">
              原始数据
              <span className="cmp-pane-sub">被删掉的行标红</span>
            </div>
            <div className="cmp-scroll">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th className="cmp-idx">#</th>
                    {base.columns.map((c) => (
                      <th key={c.key}>{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leftRows.map((row, r) => (
                    <tr key={r} className={kept.has(r) ? undefined : 'cmp-row-removed'}>
                      <td className="cmp-idx">{r + 1}</td>
                      {base.columns.map((c, ci) => (
                        <td key={c.key}>{cellText(row[ci] ?? null, c.type)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="cmp-pane">
            <div className="cmp-pane-head">
              清洗后
              <span className="cmp-pane-sub">改过的格子标绿</span>
            </div>
            <div className="cmp-scroll">
              <table className="cmp-table">
                <thead>
                  <tr>
                    <th className="cmp-idx">#</th>
                    {dataset.columns.map((c) => (
                      <th key={c.key}>{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rightRows.map((row, r) => {
                    const origin = origins[r]
                    const source = base.rows[origin]
                    return (
                      <tr key={r}>
                        <td className="cmp-idx">{(origin ?? r) + 1}</td>
                        {dataset.columns.map((c, ci) => {
                          const v = row[ci] ?? null
                          const si = sourceIndex[ci] ?? -1
                          const old = si >= 0 ? (source?.[si] ?? null) : null
                          const changed = si >= 0 && source !== undefined && cellText(old, c.type) !== cellText(v, c.type)
                          return (
                            <td key={c.key} className={changed ? 'cmp-cell-changed' : undefined}>
                              {cellText(v, c.type)}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {base.rows.length > MAX_ROWS || dataset.rows.length > MAX_ROWS ? (
          <div className="cmp-foot">
            只预览前 {MAX_ROWS} 行；完整数据请用「导出 Excel」。
          </div>
        ) : null}
      </div>
    </div>
  )
}

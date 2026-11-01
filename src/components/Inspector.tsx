import { useState } from 'react'
import type { Column, Dataset } from '../core/types'
import { resolveFillValue, type FillStrategy } from '../core/clean'
import type { OpSpec, StepRecord } from '../core/pipeline'
import type { DatasetDiff } from '../lib/diff'
import { cx, int, num, pct } from '../lib/format'

const TYPE_LABEL: Record<string, string> = {
  number: '数值',
  text: '文本',
  date: '日期',
  boolean: '布尔',
}

const SEVERITY_LABEL: Record<string, string> = { error: '严重', warn: '警告', info: '提示' }

interface Props {
  dataset: Dataset
  baseline: Dataset | null
  column: Column
  steps: StepRecord[]
  cursor: number
  diff: DatasetDiff | null
  busy: boolean
  canUndo: boolean
  canRedo: boolean
  onRun: (spec: OpSpec) => void
  onUndo: () => void
  onRedo: () => void
  onOpenTemplates: () => void
  onOpenFuzzy: () => void
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' | 'good' }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className={tone ? `tone-${tone}` : undefined}>{value}</b>
    </div>
  )
}

/** 前后对比的一行：数值 + 变化量 */
function Delta({
  label,
  before,
  after,
  goodWhenDown = true,
  format = (v: number) => int(v),
}: {
  label: string
  before: number
  after: number
  goodWhenDown?: boolean
  format?: (v: number) => string
}) {
  const changed = before !== after
  const down = after < before
  const good = goodWhenDown ? down : !down
  return (
    <div className="delta-row">
      <span className="delta-label">{label}</span>
      <span className="delta-before">{format(before)}</span>
      <span className="delta-arrow">→</span>
      <span className="delta-after">{format(after)}</span>
      {changed ? (
        <span className={cx('delta-tag', good ? 'is-good' : 'is-bad')}>
          {down ? '−' : '+'}
          {format(Math.abs(after - before))}
        </span>
      ) : (
        <span className="delta-tag is-flat">—</span>
      )}
    </div>
  )
}

export function Inspector({
  dataset,
  baseline,
  column,
  steps,
  cursor,
  diff,
  busy,
  canUndo,
  canRedo,
  onRun,
  onUndo,
  onRedo,
  onOpenTemplates,
  onOpenFuzzy,
}: Props) {
  const [strategy, setStrategy] = useState<FillStrategy>('median')
  const stats = column.numeric
  const numericText = column.type === 'text' && column.issues.some((i) => i.code === 'THOUSANDS_SEP')

  const totalOutliers = (ds: Dataset) =>
    ds.columns.reduce((a, c) => a + (c.numeric?.outliers ?? 0), 0)
  const changedCols = diff ? diff.changedByColumn.filter((n) => n > 0).length : 0

  return (
    <aside className="inspector">
      <section className="panel">
        <div className="panel-head">
          列画像
          <span className={cx('type-pill', `type-${column.type}`)}>{TYPE_LABEL[column.type]}</span>
        </div>
        <div className="panel-body">
          <div className="profile-name">{column.name}</div>
          <div className="profile-samples">
            {column.sample.length > 0 ? (
              column.sample.map((s, i) => (
                <code key={i}>{s.length > 18 ? `${s.slice(0, 18)}…` : s}</code>
              ))
            ) : (
              <span className="muted">（无示例值）</span>
            )}
          </div>

          <div className="stat-grid">
            <Stat label="非空" value={int(dataset.meta.rowCount - column.missing)} />
            <Stat
              label="缺失"
              value={`${int(column.missing)} · ${pct(column.missingRate, 1)}`}
              tone={column.missingRate > 0.2 ? 'bad' : column.missingRate > 0 ? 'warn' : undefined}
            />
            <Stat label="唯一值" value={`${int(column.distinct)}${column.distinctApprox ? '+' : ''}`} />
            <Stat
              label="异常值"
              value={stats ? int(stats.outliers) : '—'}
              tone={stats && stats.outliers > 0 ? 'warn' : undefined}
            />
          </div>

          {stats ? (
            <div className="stat-grid">
              <Stat label="中位数" value={num(stats.median)} />
              <Stat label="平均值" value={num(stats.mean)} />
              <Stat label="标准差" value={num(stats.std)} />
              <Stat label="MAD" value={num(stats.mad)} />
              <Stat label="最小" value={num(stats.min)} />
              <Stat label="最大" value={num(stats.max)} />
            </div>
          ) : column.top.length > 0 ? (
            <div className="top-values">
              {column.top.slice(0, 5).map((t) => (
                <div key={t.value} className="top-row">
                  <span className="top-label">
                    {t.value.length > 14 ? `${t.value.slice(0, 14)}…` : t.value || '（空）'}
                  </span>
                  <span className="top-bar">
                    <i style={{ width: `${Math.max(2, (t.count / (column.top[0]?.count || 1)) * 100)}%` }} />
                  </span>
                  <span className="top-count">{int(t.count)}</span>
                </div>
              ))}
            </div>
          ) : null}

          {column.issues.length > 0 ? (
            <div className="issue-list">
              {column.issues.map((issue, i) => (
                <div key={i} className={cx('issue', `issue-${issue.severity}`)}>
                  <span className="issue-tag">{SEVERITY_LABEL[issue.severity]}</span>
                  <span>{issue.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="issue-empty">这一列没有发现问题</div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          清洗动作
          <span className="panel-hint">可撤销</span>
        </div>
        <div className="panel-body">
          <div className="actions">
            <button className="btn btn-ghost" disabled={busy} onClick={() => onRun({ kind: 'trim' })}>
              清理首尾空格
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => onRun({ kind: 'dropEmptyRows' })}
            >
              删除全空行
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => onRun({ kind: 'dropDuplicates' })}
            >
              删除重复行
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={onOpenFuzzy}>
              模糊去重…
            </button>
            {numericText ? (
              <button
                className="btn btn-ghost"
                disabled={busy}
                onClick={() =>
                  onRun({ kind: 'normalizeNumbers', colIndex: column.index, colName: column.name })
                }
              >
                转成数字
              </button>
            ) : null}
          </div>

          <div className="fill-row">
            <select
              className="select"
              value={strategy}
              onChange={(e) => setStrategy(e.target.value as FillStrategy)}
              disabled={busy}
            >
              {stats ? <option value="median">用中位数填充</option> : null}
              {stats ? <option value="mean">用平均值填充</option> : null}
              <option value="mode">用出现最多的值填充</option>
              <option value="zero">填 0</option>
              <option value="text">填「未填写」</option>
            </select>
            <button
              className="btn btn-primary"
              disabled={busy || column.missing === 0}
              onClick={() =>
                onRun({
                  kind: 'fillMissing',
                  colIndex: column.index,
                  colName: column.name,
                  strategy,
                  value: resolveFillValue(column, strategy),
                })
              }
            >
              填充缺失
            </button>
          </div>
          {column.missing === 0 ? <div className="hint">这一列没有空值</div> : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
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
        <div className="panel-body">
          {baseline && diff && diff.changedCells + diff.removedRows > 0 ? (
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
              <Delta label="异常值" before={totalOutliers(baseline)} after={totalOutliers(dataset)} />
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
        </div>
      </section>

      <section className="panel panel-grow">
        <div className="panel-head">
          清洗步骤
          <span className="panel-hint">
            <button className="link-btn" onClick={onOpenTemplates}>
              模板
            </button>
            {steps.length > 0 ? (
              <span className="step-count">
                {cursor}/{steps.length}
              </span>
            ) : null}
          </span>
        </div>
        <div className="log-list">
          {steps.length === 0 ? (
            <div className="log-empty">还没有做过清洗</div>
          ) : (
            steps.map((step, i) => {
              const applied = i < cursor
              return (
                <div key={step.id} className={cx('log-item', !applied && 'is-undone')}>
                  <div className="log-title">
                    <span className="step-no">{i + 1}</span>
                    {step.title}
                    {step.affected > 0 ? <span className="log-count">{step.affected}</span> : null}
                    {!applied ? <span className="undone-tag">已撤销</span> : null}
                  </div>
                  <div className="log-detail">{step.detail}</div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </aside>
  )
}

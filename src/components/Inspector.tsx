import { useEffect, useState } from 'react'
import type { Column, Dataset } from '../core/types'
import { FILTER_LABEL, resolveFillValue, type FillStrategy, type FilterOp } from '../core/clean'
import type { OpSpec, StepRecord } from '../core/pipeline'
import type { DatasetDiff } from '../lib/diff'
import type { IssueRowKind, IssueRowSelection } from '../lib/analyze'
import { cx, int, num, pct } from '../lib/format'
import { AuxPanel } from './AuxPanel'

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
  /** 当前每行来自原始数据的第几行（左右分屏对比要用） */
  origins: number[]
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
  onOpenAi: () => void
  activeIssue: IssueRowSelection | null
  issueRows: number[]
  onToggleIssue: (kind: IssueRowKind) => void
  onJumpRow: (row: number) => void
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' | 'good' }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className={tone ? `tone-${tone}` : undefined}>{value}</b>
    </div>
  )
}

export function Inspector({
  dataset,
  baseline,
  origins,
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
  onOpenAi,
  activeIssue,
  issueRows,
  onToggleIssue,
  onJumpRow,
}: Props) {
  const [strategy, setStrategy] = useState<FillStrategy>('median')
  const [filterOp, setFilterOp] = useState<FilterOp>('gt')
  const [filterValue, setFilterValue] = useState('')
  const [renameValue, setRenameValue] = useState(column.name)
  const [opsOpen, setOpsOpen] = useState(false)
  const stats = column.numeric
  const numericText = column.type === 'text' && column.issues.some((i) => i.code === 'THOUSANDS_SEP')

  // 换列时把重命名输入框同步成当前列名
  useEffect(() => {
    setRenameValue(column.name)
  }, [column.name, column.index])

  const canFilter = filterValue.trim() !== '' && !busy
  const canRename = renameValue.trim() !== '' && renameValue.trim() !== column.name && !busy
  const lastIndex = dataset.columns.length - 1

  const runFilter = () => {
    if (!canFilter) return
    onRun({
      kind: 'filterRows',
      colIndex: column.index,
      colName: column.name,
      op: filterOp,
      value: filterValue.trim(),
    })
  }
  const doRename = () => {
    if (!canRename) return
    onRun({
      kind: 'renameColumn',
      colIndex: column.index,
      from: column.name,
      to: renameValue.trim(),
    })
  }
  const moveColumn = (to: number) => {
    onRun({ kind: 'moveColumn', from: column.index, to, colName: column.name })
  }
  const dropColumn = () => {
    onRun({ kind: 'dropColumn', colIndex: column.index, colName: column.name })
  }

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
              {column.issues.map((issue, i) => {
                const kind: IssueRowKind | null =
                  issue.code === 'MISSING'
                    ? 'missing'
                    : issue.code === 'OUTLIER'
                      ? 'outlier'
                      : null
                const expanded =
                  kind !== null &&
                  activeIssue?.columnIndex === column.index &&
                  activeIssue.kind === kind
                return (
                  <div key={i}>
                    {kind ? (
                      <button
                        type="button"
                        className={cx(
                          'issue',
                          'issue-button',
                          `issue-${issue.severity}`,
                          expanded && 'is-open',
                        )}
                        onClick={() => onToggleIssue(kind)}
                        aria-expanded={expanded}
                      >
                        <span className="issue-tag">{SEVERITY_LABEL[issue.severity]}</span>
                        <span className="issue-message">{issue.message}</span>
                        <span className="issue-toggle">{expanded ? '收起' : '查看行'}</span>
                      </button>
                    ) : (
                      <div className={cx('issue', `issue-${issue.severity}`)}>
                        <span className="issue-tag">{SEVERITY_LABEL[issue.severity]}</span>
                        <span>{issue.message}</span>
                      </div>
                    )}
                    {expanded ? (
                      <div className="issue-rows">
                        <div className="issue-rows-head">
                          定位到 {int(issueRows.length)} 行，表格中已标黄；点击行号跳转
                        </div>
                        <div className="issue-row-grid">
                          {issueRows.slice(0, 100).map((row) => (
                            <button
                              key={row}
                              type="button"
                              className="issue-row-link"
                              onClick={() => onJumpRow(row)}
                              title={`跳到第 ${row + 1} 行`}
                            >
                              第 {int(row + 1)} 行
                            </button>
                          ))}
                        </div>
                        {issueRows.length > 100 ? (
                          <div className="issue-rows-more">
                            仅列出前 100 行，其余 {int(issueRows.length - 100)} 行也已标黄
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
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

      <details
        className="panel more-ops"
        onToggle={(e) => setOpsOpen(e.currentTarget.open)}
      >
        <summary className="panel-head">
          行筛选 / 列操作
          <span className="panel-hint">{opsOpen ? '收起' : '点击'}</span>
        </summary>
        <div className="panel-body">
          <div className="ops-sub-title">行筛选 · 保留符合条件的行</div>
          <div className="fill-row">
            <select
              className="select select-narrow"
              value={filterOp}
              onChange={(e) => setFilterOp(e.target.value as FilterOp)}
              disabled={busy}
              aria-label="筛选条件"
            >
              {(Object.keys(FILTER_LABEL) as FilterOp[]).map((op) => (
                <option key={op} value={op}>
                  {FILTER_LABEL[op]}
                </option>
              ))}
            </select>
            <input
              className="select filter-input"
              value={filterValue}
              onChange={(e) => setFilterValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') runFilter()
              }}
              placeholder="条件值"
              disabled={busy}
              aria-label="条件值"
            />
          </div>
          <button className="btn btn-ghost block-btn" disabled={!canFilter} onClick={runFilter}>
            保留「{column.name}」{FILTER_LABEL[filterOp]}「{filterValue.trim() || '…'}」的行
          </button>
          <div className="hint">
            大于/小于按数值比较（条件值不是数字时按字符串序），空值不保留；包含/不包含按文本，忽略大小写
          </div>

          <div className="ops-sub-title">
            列操作 <span className="panel-hint">共 {dataset.columns.length} 列</span>
          </div>
          <div className="fill-row">
            <input
              className="select filter-input"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') doRename()
              }}
              placeholder="新列名"
              disabled={busy}
              aria-label="新列名"
            />
            <button className="btn btn-ghost" disabled={!canRename} onClick={doRename}>
              重命名
            </button>
          </div>
          <div className="actions">
            <button
              className="btn btn-ghost"
              disabled={busy || column.index === 0}
              onClick={() => moveColumn(column.index - 1)}
            >
              左移一位
            </button>
            <button
              className="btn btn-ghost"
              disabled={busy || column.index >= lastIndex}
              onClick={() => moveColumn(column.index + 1)}
            >
              右移一位
            </button>
          </div>
          <button
            className="btn btn-ghost block-btn danger-text"
            disabled={busy || dataset.columns.length <= 1}
            onClick={dropColumn}
          >
            删除「{column.name}」这一列
          </button>
          <div className="hint">至少保留一列；删除只能撤销，导出会少这一列</div>
        </div>
      </details>

      {/* 辅助功能：模板 / 前后对比 / 校验报告，可折叠 */}
      <AuxPanel
        dataset={dataset}
        baseline={baseline}
        origins={origins}
        steps={steps}
        cursor={cursor}
        diff={diff}
        busy={busy}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={onUndo}
        onRedo={onRedo}
        onOpenTemplates={onOpenTemplates}
        onOpenAi={onOpenAi}
      />

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

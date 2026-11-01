import { useState } from 'react'
import type { Column, Dataset, OpLogEntry } from '../core/types'
import type { FillStrategy } from '../core/clean'
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
  column: Column
  logs: OpLogEntry[]
  busy: boolean
  onTrim: () => void
  onFill: (strategy: FillStrategy, custom: string) => void
  onDedupe: () => void
  onDropEmpty: () => void
  onNormalizeNumbers: () => void
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'bad' }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b className={tone ? `tone-${tone}` : undefined}>{value}</b>
    </div>
  )
}

export function Inspector({
  dataset,
  column,
  logs,
  busy,
  onTrim,
  onFill,
  onDedupe,
  onDropEmpty,
  onNormalizeNumbers,
}: Props) {
  const [strategy, setStrategy] = useState<FillStrategy>('median')
  const stats = column.numeric
  const isNumber = column.type === 'number'
  const numericText = column.type === 'text' && column.issues.some((i) => i.code === 'THOUSANDS_SEP')

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
                  <span className="top-label">{t.value.length > 14 ? `${t.value.slice(0, 14)}…` : t.value || '（空）'}</span>
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
        <div className="panel-head">清洗动作</div>
        <div className="panel-body">
          <div className="actions">
            <button className="btn btn-ghost" disabled={busy} onClick={onTrim}>
              清理首尾空格
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={onDropEmpty}>
              删除全空行
            </button>
            <button className="btn btn-ghost" disabled={busy} onClick={onDedupe}>
              删除重复行
            </button>
            {numericText ? (
              <button className="btn btn-ghost" disabled={busy} onClick={onNormalizeNumbers}>
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
              {isNumber || stats ? (
                <>
                  <option value="median">用中位数填充</option>
                  <option value="mean">用平均值填充</option>
                </>
              ) : null}
              <option value="mode">用出现最多的值填充</option>
              <option value="zero">填 0</option>
              <option value="text">填「未填写」</option>
            </select>
            <button
              className="btn btn-primary"
              disabled={busy || column.missing === 0}
              onClick={() => onFill(strategy, '')}
            >
              填充缺失
            </button>
          </div>
          {column.missing === 0 ? <div className="hint">这一列没有空值</div> : null}
        </div>
      </section>

      <section className="panel panel-grow">
        <div className="panel-head">操作记录</div>
        <div className="log-list">
          {logs.length === 0 ? (
            <div className="log-empty">还没有做过清洗</div>
          ) : (
            logs.map((log) => (
              <div key={log.id} className="log-item">
                <div className="log-title">
                  {log.title}
                  {log.affected > 0 ? <span className="log-count">{log.affected}</span> : null}
                </div>
                <div className="log-detail">{log.detail}</div>
              </div>
            ))
          )}
        </div>
      </section>
    </aside>
  )
}

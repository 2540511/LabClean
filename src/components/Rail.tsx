import type { DataSource } from '../core/compare'
import type { Dataset } from '../core/types'
import { classifySeverity } from '../lib/analyze'
import { cx, int, pct } from '../lib/format'
import { SourceList } from './SourceList'

const TYPE_SHORT: Record<string, string> = {
  number: '数值',
  text: '文本',
  date: '日期',
  boolean: '布尔',
}

const DOT_COLOR = {
  good: '#059669',
  warn: '#f59e0b',
  bad: '#dc2626',
} as const

interface Props {
  dataset: Dataset
  sources: DataSource[]
  activeId: string | null
  busy: boolean
  selected: number
  onSelect: (index: number) => void
  /** 哪些列需要把异常值标红 */
  redColumns: Set<number>
  onToggleRedColumn: (index: number) => void
  onSelectSource: (id: string) => void
  onRemoveSource: (id: string) => void
  onAddSource: () => void
}

function QualityRing({ score }: { score: number }) {
  const r = 28
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, score))
  const tone = classifySeverity(clamped)
  return (
    <div className="ring">
      <svg viewBox="0 0 72 72" width="72" height="72">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#eef2f7" strokeWidth="8" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={DOT_COLOR[tone]}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 100) * c} ${c}`}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <div className="ring-text">
        <strong>{clamped}</strong>
        <span>质量分</span>
      </div>
    </div>
  )
}

export function Rail({
  dataset,
  sources,
  activeId,
  busy,
  selected,
  onSelect,
  redColumns,
  onToggleRedColumn,
  onSelectSource,
  onRemoveSource,
  onAddSource,
}: Props) {
  const { meta } = dataset
  const totalOutliers = dataset.columns.reduce((a, c) => a + (c.numeric?.outliers ?? 0), 0)
  const problemCols = dataset.columns.filter((c) => c.issues.length > 0).length

  return (
    <aside className="rail">
      <SourceList
        sources={sources}
        activeId={activeId}
        busy={busy}
        onSelect={onSelectSource}
        onRemove={onRemoveSource}
        onAdd={onAddSource}
      />

      <section className="panel">
        <div className="panel-head">
          数据体检
          <span className="panel-hint" title={dataset.name}>
            {dataset.sheet}
          </span>
        </div>
        <div className="panel-body quality-row">
          <QualityRing score={meta.score} />
          <div className="quality-stats">
            <div>
              <span>缺失率</span>
              <b>{pct(meta.totalCells ? meta.missingCells / meta.totalCells : 0, 2)}</b>
            </div>
            <div>
              <span>重复行</span>
              <b>{meta.duplicateRowsChecked ? int(meta.duplicateRows) : '未检测'}</b>
            </div>
            <div>
              <span>异常值</span>
              <b>{int(totalOutliers)}</b>
            </div>
            <div>
              <span>有问题的列</span>
              <b>
                {problemCols} / {dataset.columns.length}
              </b>
            </div>
          </div>
        </div>
      </section>

      <section className="panel panel-grow">
        <div className="panel-head">
          字段
          <span className="panel-hint">点一列查看画像</span>
        </div>
        <div className="col-list">
          {dataset.columns.map((col, i) => {
            const tone = classifySeverity(col.score)
            return (
              <div key={col.key} className="col-row">
                <button
                  className={cx('col-item', i === selected && 'is-active')}
                  onClick={() => onSelect(i)}
                  title={col.issues.map((x) => x.message).join('；') || '没有发现问题'}
                >
                  <i className="col-dot" style={{ background: DOT_COLOR[tone] }} />
                  <span className="col-name">{col.name}</span>
                  <span className={cx('type-pill', `type-${col.type}`)}>{TYPE_SHORT[col.type]}</span>
                  {col.issues.length > 0 ? <span className="col-badge">{col.issues.length}</span> : null}
                </button>
                {col.numeric ? (
                  <button
                    className={cx('red-toggle', redColumns.has(i) && 'is-on')}
                    onClick={() => onToggleRedColumn(i)}
                    aria-pressed={redColumns.has(i)}
                    title={
                      redColumns.has(i)
                        ? '不再标红这一列的异常值'
                        : '把这一列的异常值标红（可多选）'
                    }
                  >
                    ●
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      </section>
    </aside>
  )
}

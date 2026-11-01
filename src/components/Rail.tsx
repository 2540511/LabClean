import type { Dataset, SheetInfo } from '../core/types'
import { classifySeverity } from '../lib/analyze'
import { cx, int, pct } from '../lib/format'

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
  sheets: SheetInfo[]
  activeSheet: number
  onSheet: (index: number) => void
  selected: number
  onSelect: (index: number) => void
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

export function Rail({ dataset, sheets, activeSheet, onSheet, selected, onSelect }: Props) {
  const { meta } = dataset
  const totalOutliers = dataset.columns.reduce((a, c) => a + (c.numeric?.outliers ?? 0), 0)
  const problemCols = dataset.columns.filter((c) => c.issues.length > 0).length

  return (
    <aside className="rail">
      <section className="panel">
        <div className="panel-head">数据源</div>
        <div className="panel-body">
          <div className="ds-name" title={meta.source || dataset.name}>
            {dataset.name}
          </div>
          <div className="ds-meta">
            {dataset.sheet} · {int(meta.rowCount)} 行 × {meta.colCount} 列
          </div>
          {sheets.length > 1 ? (
            <select
              className="sheet-select"
              value={activeSheet}
              onChange={(e) => onSheet(Number(e.target.value))}
            >
              {sheets.map((s, i) => (
                <option key={s.name + i} value={i}>
                  {s.name}（{int(s.rowCount)} 行）
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">数据体检</div>
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
              <button
                key={col.key}
                className={cx('col-item', i === selected && 'is-active')}
                onClick={() => onSelect(i)}
                title={col.issues.map((x) => x.message).join('；') || '没有发现问题'}
              >
                <i className="col-dot" style={{ background: DOT_COLOR[tone] }} />
                <span className="col-name">{col.name}</span>
                <span className={cx('type-pill', `type-${col.type}`)}>{TYPE_SHORT[col.type]}</span>
                {col.issues.length > 0 ? <span className="col-badge">{col.issues.length}</span> : null}
              </button>
            )
          })}
        </div>
      </section>
    </aside>
  )
}

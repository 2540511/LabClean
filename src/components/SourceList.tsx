import type { DataSource } from '../core/compare'
import { cx, int } from '../lib/format'

interface Props {
  sources: DataSource[]
  activeId: string | null
  busy: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => void
  onAdd: () => void
}

export function SourceList({ sources, activeId, busy, onSelect, onRemove, onAdd }: Props) {
  return (
    <section className="panel panel-sources">
      <div className="panel-head">
        数据源
        <span className="panel-hint">{sources.length} 个</span>
      </div>
      <div className="source-list">
        {sources.map((s) => (
          <div
            key={s.id}
            className={cx('source-item', s.id === activeId && 'is-active')}
            onClick={() => onSelect(s.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect(s.id)
            }}
          >
            <div className="source-line">
              <span className="source-name" title={`${s.name} · ${s.sheet}`}>
                {s.name}
              </span>
              {sources.length > 1 ? (
                <button
                  className="source-del"
                  title="移除这个数据源"
                  onClick={(e) => {
                    e.stopPropagation()
                    onRemove(s.id)
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
            <div className="source-sub">
              {s.sheet} · {int(s.baseline.meta.rowCount)} 行
              {s.cursor > 0 ? <span className="source-badge">已清洗 {s.cursor} 步</span> : null}
            </div>
          </div>
        ))}
      </div>
      <button className="btn source-add" onClick={onAdd} disabled={busy}>
        ＋ 添加数据源
      </button>
    </section>
  )
}

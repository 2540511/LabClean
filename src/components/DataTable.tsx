import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dataset } from '../core/types'
import { formatCell, isBlank } from '../core/value'
import { cx, int } from '../lib/format'

const ROW_H = 30
const IDX_W = 64
const OVERSCAN = 6

const TYPE_SHORT: Record<string, string> = {
  number: '数值',
  text: '文本',
  date: '日期',
  boolean: '布尔',
}

interface Props {
  dataset: Dataset
  selected: number
  onSelect: (index: number) => void
  outlierRows: Set<number>
}

export function DataTable({ dataset, selected, onSelect, outlierRows }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(480)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewH(el.clientHeight))
    ro.observe(el)
    setViewH(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) {
      el.scrollTop = 0
      setScrollTop(0)
    }
  }, [dataset])

  const widths = useMemo(
    () =>
      dataset.columns.map((c) => {
        // 中文字符宽度按 2 个西文算，否则「浓度(mg/L)」这类表头会被截断
        const displayLen = (s: string) => {
          let n = 0
          for (const ch of s) n += ch.charCodeAt(0) > 0x2e80 ? 2 : 1
          return n
        }
        const longest = Math.max(
          displayLen(c.name),
          ...c.sample.map(displayLen),
          4,
        )
        return Math.max(104, Math.min(300, longest * 8 + 62))
      }),
    [dataset.columns],
  )
  const totalW = useMemo(() => widths.reduce((a, b) => a + b, IDX_W), [widths])

  const rows = dataset.rows
  const columns = dataset.columns
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN)

  const visible: number[] = []
  for (let i = start; i < end; i++) visible.push(i)

  return (
    <div className="table-panel">
      <div className="table-head-bar">
        <span className="table-title">数据预览</span>
        <span className="table-sub">
          共 {int(rows.length)} 行 · {columns.length} 列
          {dataset.meta.duplicateRowsChecked
            ? ` · 重复行 ${int(dataset.meta.duplicateRows)}`
            : ' · 未检测重复行'}
        </span>
        <span className="spacer" />
        <span className="legend">
          <i className="dot dot-missing" /> 空值
          <i className="dot dot-outlier" /> 异常值
        </span>
      </div>

      <div
        className="table-scroll"
        ref={scrollRef}
        onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
      >
        <div className="table-inner" style={{ width: totalW }}>
          <div className="tr tr-head">
            <div className="td td-idx" style={{ width: IDX_W }}>
              #
            </div>
            {columns.map((col, i) => (
              <div
                key={col.key}
                className={cx('td', 'td-th', i === selected && 'is-selected')}
                style={{ width: widths[i] }}
                onClick={() => onSelect(i)}
                title={`${col.name}（${TYPE_SHORT[col.type]}）质量分 ${col.score}`}
              >
                <span className="th-name">{col.name}</span>
                <span className={cx('type-pill', `type-${col.type}`)}>{TYPE_SHORT[col.type]}</span>
              </div>
            ))}
          </div>

          <div className="tbody" style={{ height: rows.length * ROW_H }}>
            {visible.map((r) => {
              const row = rows[r]
              const isOutlierRow = outlierRows.has(r)
              return (
                <div
                  key={r}
                  className={cx('tr', r % 2 === 1 && 'tr-alt', isOutlierRow && 'tr-outlier')}
                  style={{ top: r * ROW_H, height: ROW_H }}
                >
                  <div className="td td-idx" style={{ width: IDX_W }}>
                    {r + 1}
                  </div>
                  {columns.map((col, c) => {
                    const v = row[c] ?? null
                    const empty = isBlank(v)
                    const isOutlierCell = isOutlierRow && c === selected
                    return (
                      <div
                        key={col.key}
                        className={cx(
                          'td',
                          col.type === 'number' && 'td-num',
                          c === selected && 'is-selected',
                          empty && 'td-empty',
                          isOutlierCell && 'td-outlier',
                        )}
                        style={{ width: widths[c] }}
                        title={empty ? '空值' : String(formatCell(v, col.type))}
                      >
                        {empty ? '∅' : formatCell(v, col.type)}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

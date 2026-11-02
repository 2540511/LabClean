import { useEffect, useMemo, useRef, useState } from 'react'
import type { CellValue, Dataset } from '../core/types'
import { formatCell, isBlank } from '../core/value'
import { isOutlierValue, type OutlierMode, type OutlierSettings } from '../lib/analyze'
import { sameCell } from '../lib/diff'
import { cx, int } from '../lib/format'
import { OutlierControls } from './OutlierControls'

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
  /** 哪些列需要把异常值标红 */
  redColumns: Set<number>
  outlierMode: OutlierMode
  onOutlierMode: (mode: OutlierMode) => void
  outlierSettings: OutlierSettings
  onOutlierSettings: (next: OutlierSettings) => void
  /** 按当前设置统计出来的异常值总数（-1 = 数据太大未统计） */
  outlierCount: number
  /** 原始数据 + 行来源映射，用来标出被清洗改动过的单元格 */
  compare?: { rows: CellValue[][]; origins: number[] } | null
  /** 手动点选的行（0 基下标），用于逐行删除 */
  selectedRows: Set<number>
  onToggleRow: (row: number) => void
  onClearRows: () => void
  onDeleteRows: () => void
}

export function DataTable({
  dataset,
  selected,
  onSelect,
  redColumns,
  outlierMode,
  onOutlierMode,
  outlierSettings,
  onOutlierSettings,
  outlierCount,
  compare,
  selectedRows,
  onToggleRow,
  onClearRows,
  onDeleteRows,
}: Props) {
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
        {selectedRows.size > 0 ? (
          <>
            <span className="sel-info">已选 {int(selectedRows.size)} 行</span>
            <button className="btn btn-small danger-text" onClick={onDeleteRows}>
              删除选中的行
            </button>
            <button className="btn btn-small" onClick={onClearRows}>
              取消选择
            </button>
          </>
        ) : (
          <>
            <span className="legend">
              <i className="dot dot-missing" /> 空值
              {redColumns.size > 0 ? (
                <>
                  <i className="dot dot-outlier" /> 异常值
                </>
              ) : null}
              {compare ? (
                <>
                  <i className="dot dot-changed" /> 已改动
                </>
              ) : null}
            </span>
            <span className="table-tip">点一行可选中，再点一次取消</span>
          </>
        )}
        <OutlierControls
          mode={outlierMode}
          onMode={onOutlierMode}
          settings={outlierSettings}
          onSettings={onOutlierSettings}
          count={outlierCount}
          redColumnCount={redColumns.size}
        />
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
              // 这一行里有没有「需要标红的列」出了异常值 —— 用列上算好的稳健上下界判断，不用扫全表
              let isOutlierRow = false
              for (const c of redColumns) {
                const col = columns[c]
                if (col && isOutlierValue(row[c] ?? null, col, outlierSettings)) {
                  isOutlierRow = true
                  break
                }
              }
              return (
                <div
                  key={r}
                  className={cx(
                    'tr',
                    'tr-body',
                    r % 2 === 1 && 'tr-alt',
                    isOutlierRow && 'tr-outlier',
                    selectedRows.has(r) && 'tr-picked',
                  )}
                  style={{ top: r * ROW_H, height: ROW_H }}
                  onClick={() => onToggleRow(r)}
                  title={selectedRows.has(r) ? '再点一次取消选中' : '点一下选中这一行'}
                >
                  <div className="td td-idx" style={{ width: IDX_W }}>
                    {r + 1}
                  </div>
                  {columns.map((col, c) => {
                    const v = row[c] ?? null
                    const empty = isBlank(v)
                    const isOutlierCell = redColumns.has(c) && isOutlierValue(v, col, outlierSettings)
                    const sourceRow = compare ? compare.rows[compare.origins[r]] : undefined
                    const oldValue = compare && sourceRow ? (sourceRow[c] ?? null) : null
                    const changed = compare && sourceRow ? !sameCell(oldValue, v) : false
                    return (
                      <div
                        key={col.key}
                        className={cx(
                          'td',
                          col.type === 'number' && 'td-num',
                          c === selected && 'is-selected',
                          empty && 'td-empty',
                          isOutlierCell && 'td-outlier',
                          changed && 'td-changed',
                        )}
                        style={{ width: widths[c] }}
                        title={
                          changed
                            ? `原值：${isBlank(oldValue) ? '（空）' : String(formatCell(oldValue, col.type))}`
                            : empty
                              ? '空值'
                              : String(formatCell(v, col.type))
                        }
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

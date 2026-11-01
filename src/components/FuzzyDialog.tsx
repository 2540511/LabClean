import { useCallback, useEffect, useState } from 'react'
import type { CellValue, Column } from '../core/types'
import {
  DEFAULT_FUZZY,
  findFuzzyGroups,
  normalizeText,
  type FuzzyOptions,
  type FuzzyResult,
  type PinyinFn,
} from '../core/fuzzy'
import { cx, int, pct } from '../lib/format'

interface Props {
  open: boolean
  rows: CellValue[][]
  column: Column
  busy: boolean
  /** 打开后立即扫描（演示 / 截图用） */
  autoScan?: boolean
  onClose: () => void
  onApply: (threshold: number, dropRows: number[]) => void
}

/** 拼音转换体积不小，改成用到时才动态加载，不用的人不下载 */
async function loadPinyin(): Promise<PinyinFn> {
  const mod = await import('pinyin-pro')
  return (s: string) =>
    mod
      .pinyin(s, { toneType: 'none', type: 'array', nonZh: 'consecutive' })
      .join('')
      .toLowerCase()
}

export function FuzzyDialog({ open, rows, column, busy, autoScan, onClose, onApply }: Props) {
  const [opt, setOpt] = useState<FuzzyOptions>(DEFAULT_FUZZY)
  const [result, setResult] = useState<FuzzyResult | null>(null)
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const scan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      let toPinyin: PinyinFn | undefined
      if (opt.usePinyin) toPinyin = await loadPinyin()
      // 让浏览器先把「扫描中」画出来
      await new Promise((r) => setTimeout(r, 10))
      setResult(findFuzzyGroups(rows, column.index, opt, toPinyin))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setScanning(false)
    }
  }, [column.index, opt, rows])

  useEffect(() => {
    if (open && autoScan) void scan()
    // 只在打开或换了列时自动扫一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoScan, column.index])

  // 换列必须清空上一次的结果，否则会拿别的列算出来的行号去删行
  useEffect(() => {
    setResult(null)
    setError(null)
  }, [column.index])

  useEffect(() => {
    if (!open) {
      setResult(null)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const sample = column.sample[0] ?? ''
  const preview = sample ? normalizeText(sample, opt) : ''

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-head">
          <strong>模糊去重 · {column.name}</strong>
          <button className="modal-x" onClick={onClose} title="关闭 (Esc)">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="fuzzy-opts">
            <label className="fuzzy-threshold">
              <span>
                相似度阈值 <b>{opt.threshold.toFixed(2)}</b>
              </span>
              <input
                type="range"
                min={0.6}
                max={1}
                step={0.01}
                value={opt.threshold}
                onChange={(e) => {
                  setOpt({ ...opt, threshold: Number(e.target.value) })
                  setResult(null)
                }}
              />
            </label>
            <div className="fuzzy-checks">
              <label>
                <input
                  type="checkbox"
                  checked={opt.ignoreSpaces}
                  onChange={(e) => {
                    setOpt({ ...opt, ignoreSpaces: e.target.checked })
                    setResult(null)
                  }}
                />
                忽略空格
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={opt.ignoreCase}
                  onChange={(e) => {
                    setOpt({ ...opt, ignoreCase: e.target.checked })
                    setResult(null)
                  }}
                />
                忽略大小写
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={opt.ignorePunctuation}
                  onChange={(e) => {
                    setOpt({ ...opt, ignorePunctuation: e.target.checked })
                    setResult(null)
                  }}
                />
                忽略标点
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={opt.usePinyin}
                  onChange={(e) => {
                    setOpt({ ...opt, usePinyin: e.target.checked })
                    setResult(null)
                  }}
                />
                转拼音比较
              </label>
            </div>
          </div>

          <p className="tpl-hint">
            归一化示例：「{sample || '—'}」→「{preview || '—'}」。比较在归一化后的文本上做编辑距离，
            相似度 = 1 − 距离 ÷ 较长串长度。每组只保留第一条，删之前请先看下面的对照。
          </p>

          <div className="fuzzy-actions">
            <button className="btn" onClick={() => void scan()} disabled={scanning || busy}>
              {scanning ? '扫描中…' : result ? '重新扫描' : '开始扫描'}
            </button>
            {result ? (
              <button
                className="btn btn-primary"
                disabled={busy || result.dropRows.length === 0}
                onClick={() => onApply(opt.threshold, result.dropRows)}
              >
                删除 {int(result.dropRows.length)} 行
              </button>
            ) : null}
            {result ? (
              <span className="fuzzy-summary">
                扫描 {int(result.scanned)} 个非空值 · 发现 {int(result.groups.length)} 组疑似重复
                {result.groups.length > 0 ? `（共 ${int(result.dropRows.length)} 行会被删除）` : ''}
                {result.truncated ? ' · 数据较大，只扫描了前 2 万行' : ''}
              </span>
            ) : null}
          </div>

          {error ? <div className="fuzzy-error">{error}</div> : null}

          {result && result.dropRows.length / Math.max(1, rows.length) > 0.2 ? (
            <div className="fuzzy-warn">
              <strong>注意：这会删除 {pct(result.dropRows.length / Math.max(1, rows.length), 1)} 的行</strong>
              <span>
                模糊去重适合「一行对应一个实体」的列（客户名、样品名、机构名）。
                像「记录人」「状态」这类本来就该重复的列，用它会把正常数据删掉。
              </span>
            </div>
          ) : null}

          {result && result.groups.length === 0 ? (
            <div className="log-empty">在这个阈值下没有发现疑似重复</div>
          ) : null}

          <div className="fuzzy-groups">
            {result?.groups.map((g, gi) => (
              <div className="fuzzy-group" key={gi}>
                <span className="fg-index">{gi + 1}</span>
                <div className="fg-values">
                  {g.values.slice(0, 8).map((v, vi) => (
                    <span key={vi} className={cx('fg-chip', vi === 0 && 'is-keep')}>
                      {v.length > 22 ? `${v.slice(0, 22)}…` : v}
                      {vi === 0 ? <em>保留</em> : null}
                    </span>
                  ))}
                  {g.values.length > 8 ? (
                    <span className="fg-more">…共 {g.values.length} 个（删 {g.values.length - 1} 个）</span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import {
  DEFAULT_OUTLIER_SETTINGS,
  OUTLIER_K_RANGE,
  type HistSetting,
  type OutlierMode,
  type OutlierSettings,
} from '../lib/analyze'
import { cx, int } from '../lib/format'

const MODE_LABEL: Record<OutlierMode, string> = {
  all: '全部数值列',
  current: '当前列',
  custom: '自定义列',
  none: '关闭',
}

const MODES: OutlierMode[] = ['all', 'current', 'custom', 'none']

/** 常用的组数 / 组距，一键选 */
const COUNT_PRESETS = [5, 8, 10, 12, 15, 20, 30]

interface Props {
  open: boolean
  onClose: () => void

  mode: OutlierMode
  onMode: (mode: OutlierMode) => void
  settings: OutlierSettings
  onSettings: (next: OutlierSettings) => void
  outlierCount: number
  redColumnCount: number

  hist: HistSetting
  onHist: (next: HistSetting) => void
  /** 当前实际分的组数（含自动模式） */
  effectiveBins: number
  /** 自动模式会用的组数 */
  autoBins: number
  /** 一组的宽度 */
  binWidth: number | null
  histFrom: number | null
  histTo: number | null
}

/**
 * 数字输入框：允许过程中留空 / 负数，失焦或回车时才提交并夹紧到范围内。
 * 直接用受控 number 输入会在用户敲字中途被四舍五入，很难填精确值。
 */
function NumberField({
  value,
  min,
  max,
  step = 1,
  unit,
  onCommit,
}: {
  value: number
  min: number
  max: number
  step?: number
  unit: string
  onCommit: (v: number) => void
}) {
  const [text, setText] = useState(String(value))

  useEffect(() => {
    setText(String(value))
  }, [value])

  const commit = () => {
    const n = Number(text)
    if (!Number.isFinite(n) || n <= 0) {
      setText(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, n))
    setText(String(clamped))
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <span className="num-field">
      <input
        type="number"
        className="num-input"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        aria-label={unit}
      />
      <span className="num-unit">{unit}</span>
    </span>
  )
}

export function SettingsDialog({
  open,
  onClose,
  mode,
  onMode,
  settings,
  onSettings,
  outlierCount,
  redColumnCount,
  hist,
  onHist,
  effectiveBins,
  autoBins,
  binWidth,
  histFrom,
  histTo,
}: Props) {
  const [tab, setTab] = useState<'outlier' | 'chart'>(() =>
    new URLSearchParams(window.location.search).get('tab') === 'chart' ? 'chart' : 'outlier',
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const range = OUTLIER_K_RANGE[settings.method]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-head">
          <strong>显示设置</strong>
          <button className="modal-x" onClick={onClose} title="关闭 (Esc)">
            ×
          </button>
        </div>

        <div className="settings-tabs">
          <button
            className={cx('settings-tab', tab === 'outlier' && 'is-active')}
            onClick={() => setTab('outlier')}
          >
            异常标红
          </button>
          <button
            className={cx('settings-tab', tab === 'chart' && 'is-active')}
            onClick={() => setTab('chart')}
          >
            分布直方图
          </button>
        </div>

        <div className="modal-body">
          {tab === 'outlier' ? (
            <>
              <div className="pop-row">
                <span className="pop-label">标红范围</span>
                <div className="seg">
                  {MODES.map((m) => (
                    <button
                      key={m}
                      className={cx('seg-btn', mode === m && 'is-active')}
                      onClick={() => onMode(m)}
                    >
                      {MODE_LABEL[m]}
                    </button>
                  ))}
                </div>
                {mode === 'custom' ? (
                  <span className="pop-hint">
                    到左侧字段列表点小圆点增减要标红的列（已选 {redColumnCount} 列）
                  </span>
                ) : null}
              </div>

              <div className="pop-row">
                <span className="pop-label">判定方式</span>
                <div className="seg">
                  <button
                    className={cx('seg-btn', settings.method === 'mad' && 'is-active')}
                    onClick={() => onSettings(DEFAULT_OUTLIER_SETTINGS)}
                  >
                    稳健 Z（中位数 + MAD）
                  </button>
                  <button
                    className={cx('seg-btn', settings.method === 'iqr' && 'is-active')}
                    onClick={() => onSettings({ method: 'iqr', k: 1.5 })}
                  >
                    四分位（IQR）
                  </button>
                </div>
              </div>

              <div className="pop-row">
                <span className="pop-label">
                  阈值 <b>{settings.k.toFixed(1)}</b>
                </span>
                <input
                  type="range"
                  className="pop-range"
                  min={range.min}
                  max={range.max}
                  step={range.step}
                  value={settings.k}
                  onChange={(e) => onSettings({ ...settings, k: Number(e.target.value) })}
                  aria-label="异常判定阈值"
                />
                <span className="pop-hint">
                  {settings.method === 'mad'
                    ? '稳健 Z：|值 − 中位数| ÷ (MAD ÷ 0.6745) 超过阈值即算异常。数值越小判得越严。'
                    : '四分位：落在 [Q1 − k×IQR, Q3 + k×IQR] 之外的算异常。常用 1.5。'}
                </span>
              </div>

              <div className="pop-stat">
                当前设置下：
                <b>{outlierCount < 0 ? '未统计（数据过大）' : int(outlierCount)}</b> 个异常值
              </div>
            </>
          ) : (
            <>
              <div className="pop-row">
                <span className="pop-label">分箱方式</span>
                <div className="seg">
                  <button
                    className={cx('seg-btn', hist.mode === 'auto' && 'is-active')}
                    onClick={() => onHist({ mode: 'auto' })}
                  >
                    自动
                  </button>
                  <button
                    className={cx('seg-btn', hist.mode === 'count' && 'is-active')}
                    onClick={() => onHist({ mode: 'count', n: effectiveBins || autoBins })}
                  >
                    按组数
                  </button>
                  <button
                    className={cx('seg-btn', hist.mode === 'width' && 'is-active')}
                    onClick={() =>
                      onHist({ mode: 'width', w: binWidth && binWidth > 0 ? Number(binWidth.toPrecision(2)) : 1 })
                    }
                  >
                    按组距
                  </button>
                </div>
                <span className="pop-hint">
                  {hist.mode === 'auto'
                    ? `当前自动分成 ${autoBins} 组（按 √行数 估算）。`
                    : hist.mode === 'count'
                      ? '直接填组数，写实验报告时填「分 10 组」这种正好用。'
                      : '填每一组的宽度，组数由区间宽度自动算出。'}
                </span>
              </div>

              {hist.mode === 'count' ? (
                <div className="pop-row">
                  <span className="pop-label">组数</span>
                  <div className="fill-row">
                    <NumberField
                      value={hist.n}
                      min={2}
                      max={200}
                      unit="组"
                      onCommit={(v) => onHist({ mode: 'count', n: v })}
                    />
                    <span className="preset-row">
                      {COUNT_PRESETS.map((n) => (
                        <button
                          key={n}
                          className={cx('preset-btn', hist.n === n && 'is-active')}
                          onClick={() => onHist({ mode: 'count', n })}
                        >
                          {n}
                        </button>
                      ))}
                    </span>
                  </div>
                </div>
              ) : null}

              {hist.mode === 'width' ? (
                <div className="pop-row">
                  <span className="pop-label">组距</span>
                  <div className="fill-row">
                    <NumberField
                      value={hist.w}
                      min={0.000001}
                      max={1e9}
                      step={0.1}
                      unit=""
                      onCommit={(v) => onHist({ mode: 'width', w: v })}
                    />
                    <span className="pop-hint">→ 实际分成 {effectiveBins} 组</span>
                  </div>
                </div>
              ) : null}

              {hist.mode !== 'auto' ? (
                <div className="pop-row">
                  <span className="pop-label">
                    组数 <b>{effectiveBins}</b>
                    {binWidth !== null ? (
                      <>
                        {' '}
                        · 组距 <b>{binWidth < 0.01 ? binWidth.toExponential(2) : Number(binWidth.toPrecision(4))}</b>
                      </>
                    ) : null}
                  </span>
                  <input
                    type="range"
                    className="pop-range"
                    min={5}
                    max={60}
                    step={1}
                    value={Math.min(60, Math.max(5, effectiveBins))}
                    onChange={(e) => onHist({ mode: 'count', n: Number(e.target.value) })}
                    aria-label="组数滑块"
                  />
                </div>
              ) : null}

              {histFrom !== null && histTo !== null ? (
                <div className="pop-stat">
                  统计区间 <b>{Number(histFrom.toPrecision(6))}</b> ~{' '}
                  <b>{Number(histTo.toPrecision(6))}</b>（异常值单独成柱，不计入组距）
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import {
  OUTLIER_K_RANGE,
  type OutlierMode,
  type OutlierSettings,
} from '../lib/analyze'
import { cx, int } from '../lib/format'

const MODE_LABEL: Record<OutlierMode, string> = {
  current: '当前列',
  all: '全部数值列',
  custom: '自定义列',
  none: '关闭',
}

const MODES: OutlierMode[] = ['all', 'current', 'custom', 'none']

interface Props {
  mode: OutlierMode
  onMode: (mode: OutlierMode) => void
  settings: OutlierSettings
  onSettings: (next: OutlierSettings) => void
  /** 按当前设置算出来的异常值总数；-1 表示数据太大没统计 */
  count: number
  redColumnCount: number
}

export function OutlierControls({ mode, onMode, settings, onSettings, count, redColumnCount }: Props) {
  // ?outlier=1 直接展开设置面板（演示 / 截图用）
  const [open, setOpen] = useState(
    () => new URLSearchParams(window.location.search).get('outlier') === '1',
  )
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const range = OUTLIER_K_RANGE[settings.method]
  const ruleText =
    settings.method === 'mad' ? `稳健 Z > ${settings.k.toFixed(1)}` : `IQR × ${settings.k.toFixed(1)}`

  return (
    <div className="outlier-box" ref={boxRef}>
      <button
        className={cx('outlier-trigger', mode !== 'none' && 'is-on')}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <i className="dot dot-outlier" />
        异常标红
        <span className="outlier-trigger-sub">
          {MODE_LABEL[mode]}
          {mode !== 'none' ? ` · ${ruleText}` : ''}
        </span>
        <span className="outlier-caret">▾</span>
      </button>

      {open ? (
        <div className="outlier-pop" role="dialog" aria-label="异常值标红设置">
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
          </div>

          <div className="pop-row">
            <span className="pop-label">判定方式</span>
            <div className="seg">
              <button
                className={cx('seg-btn', settings.method === 'mad' && 'is-active')}
                onClick={() => onSettings({ method: 'mad', k: 3.5 })}
              >
                稳健 Z（中位数+MAD）
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
          </div>

          <p className="pop-hint">
            {settings.method === 'mad'
              ? '稳健 Z：|值 − 中位数| ÷ (MAD ÷ 0.6745) 超过阈值就算异常。阈值越小判得越严。'
              : '四分位：落在 [Q1 − k×IQR, Q3 + k×IQR] 之外的算异常。常用 1.5。'}
          </p>

          <div className="pop-stat">
            当前设置下：<b>{count < 0 ? '未统计（数据过大）' : int(count)}</b> 个异常值
            {mode === 'custom' ? `，已选 ${redColumnCount} 列` : ''}
            {mode === 'custom' ? '（去左侧字段列表点小圆点增减）' : ''}
          </div>
        </div>
      ) : null}
    </div>
  )
}

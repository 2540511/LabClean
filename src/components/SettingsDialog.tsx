import { useEffect, useState } from 'react'
import {
  DEFAULT_OUTLIER_SETTINGS,
  OUTLIER_K_RANGE,
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

interface Props {
  open: boolean
  onClose: () => void

  mode: OutlierMode
  onMode: (mode: OutlierMode) => void
  settings: OutlierSettings
  onSettings: (next: OutlierSettings) => void
  outlierCount: number
  redColumnCount: number

  /** 分布直方图分箱数；null 表示自动 */
  bins: number | null
  onBins: (bins: number | null) => void
  /** 自动模式下实际用的箱数，用于展示 */
  autoBins: number
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
  bins,
  onBins,
  autoBins,
}: Props) {
  const [tab, setTab] = useState<'outlier' | 'chart'>('outlier')

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
  const effectiveBins = bins ?? autoBins

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
                  <span className="pop-hint">到左侧字段列表点小圆点增减要标红的列（已选 {redColumnCount} 列）</span>
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
                <span className="pop-label">
                  分箱数 <b>{effectiveBins}</b>
                  {bins === null ? '（自动）' : ''}
                </span>
                <input
                  type="range"
                  className="pop-range"
                  min={5}
                  max={60}
                  step={1}
                  value={effectiveBins}
                  onChange={(e) => onBins(Number(e.target.value))}
                  aria-label="直方图分箱数"
                />
                <span className="pop-hint">
                  箱子越多越细，但每个柱子里的样本也越少；太少会看不出分布形状。
                  自动模式按 √行数 估算（当前 {autoBins} 箱）。
                </span>
              </div>
              <div className="pop-row">
                <button className="btn btn-small" onClick={() => onBins(null)} disabled={bins === null}>
                  恢复自动
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

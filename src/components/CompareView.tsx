import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import type { DataSource, SourceMetrics } from '../core/compare'
import { sourceMetrics } from '../core/compare'
import { classifySeverity } from '../lib/analyze'
import { cx, int, pct } from '../lib/format'
import { Chart } from './Chart'

interface Props {
  sources: DataSource[]
  activeId: string | null
  onPick: (id: string) => void
  onAdd: () => void
}

const SCORE_COLOR = {
  good: '#059669',
  warn: '#d97706',
  bad: '#dc2626',
} as const

function MiniBar({
  label,
  rate,
  max,
  color,
}: {
  label: string
  rate: number
  max: number
  color: string
}) {
  const width = max > 0 ? (rate / max) * 100 : 0
  return (
    <div className="mini-bar-row">
      <span className="mini-label">{label}</span>
      <span className="mini-track">
        <i style={{ width: `${Math.max(width, rate > 0 ? 4 : 0)}%`, background: color }} />
      </span>
      <span className="mini-value">{pct(rate, 2)}</span>
    </div>
  )
}

function MiniHist({ values, label }: { values: number[]; label: string }) {
  const max = Math.max(1, ...values)
  return (
    <div className="mini-hist" title={`${label} 分布`}>
      {values.map((v, i) => (
        <i key={i} style={{ height: `${Math.max((v / max) * 100, v > 0 ? 4 : 1)}%` }} />
      ))}
    </div>
  )
}

function Card({
  metrics,
  maxes,
  active,
  onPick,
}: {
  metrics: SourceMetrics
  maxes: { missing: number; dup: number; outlier: number }
  active: boolean
  onPick: () => void
}) {
  const tone = classifySeverity(metrics.score)
  return (
    <div className={cx('compare-card', active && 'is-active')} onClick={onPick}>
      <div className="cc-head">
        <span className="cc-name" title={`${metrics.name} · ${metrics.sheet}`}>
          {metrics.name}
        </span>
        <span className="cc-score" style={{ color: SCORE_COLOR[tone], borderColor: SCORE_COLOR[tone] }}>
          {metrics.score}
        </span>
      </div>
      <div className="cc-sub">
        {metrics.sheet} · {int(metrics.rows)} 行 × {metrics.cols} 列
      </div>

      {metrics.histogram.length > 0 ? (
        <div className="cc-hist-wrap">
          <MiniHist values={metrics.histogram} label={metrics.histLabel} />
          <span className="cc-hist-label">{metrics.histLabel}</span>
        </div>
      ) : null}

      <div className="cc-bars" title="条形长度按各指标中的最大值归一，便于横向比较">
        <MiniBar label="缺失" rate={metrics.missingRate} max={maxes.missing} color="#f59e0b" />
        <MiniBar label="重复" rate={metrics.duplicateRate} max={maxes.dup} color="#a855f7" />
        <MiniBar label="异常" rate={metrics.outlierRate} max={maxes.outlier} color="#ef4444" />
      </div>

      <div className="cc-foot">
        {metrics.steps > 0 ? `已清洗 ${metrics.steps} 步` : '未清洗'}
        {metrics.removedRows > 0 ? ` · 删 ${int(metrics.removedRows)} 行` : ''}
      </div>
    </div>
  )
}

export function CompareView({ sources, activeId, onPick, onAdd }: Props) {
  const metrics = useMemo(() => sources.map(sourceMetrics), [sources])

  /** 三个指标各自按最大值归一，否则 2% 的缺失率在 0–100% 刻度上只剩一条线 */
  const maxes = useMemo(
    () => ({
      missing: Math.max(0.0001, ...metrics.map((m) => m.missingRate)),
      dup: Math.max(0.0001, ...metrics.map((m) => m.duplicateRate)),
      outlier: Math.max(0.0001, ...metrics.map((m) => m.outlierRate)),
    }),
    [metrics],
  )

  const chartOption = useMemo<EChartsOption>(() => {
    const labels = metrics.map((m) => (m.sheet ? `${m.name} · ${m.sheet}` : m.name))
    const short = labels.map((l) => (l.length > 18 ? `${l.slice(0, 18)}…` : l))
    const series = [
      { name: '缺失率', data: metrics.map((m) => m.missingRate), color: '#f59e0b' },
      { name: '重复率', data: metrics.map((m) => m.duplicateRate), color: '#a855f7' },
      { name: '异常率', data: metrics.map((m) => m.outlierRate), color: '#ef4444' },
    ]
    return {
      grid: { left: 8, right: 60, top: 30, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        valueFormatter: (v: unknown) => (typeof v === 'number' ? pct(v, 2) : String(v)),
      },
      legend: { top: 0, itemWidth: 10, itemHeight: 10, textStyle: { fontSize: 11, color: '#64748b' } },
      xAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => `${(v * 100).toFixed(1)}%`, fontSize: 11, color: '#64748b' },
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: short,
        inverse: true,
        axisLabel: { fontSize: 11, color: '#475569' },
        axisLine: { lineStyle: { color: '#e2e8f0' } },
        axisTick: { show: false },
      },
      series: series.map((s) => ({
        name: s.name,
        type: 'bar' as const,
        data: s.data,
        itemStyle: { color: s.color, borderRadius: [0, 2, 2, 0] },
        barMaxWidth: 12,
      })),
    }
  }, [metrics])

  const totalRows = metrics.reduce((a, m) => a + m.rows, 0)
  const avgScore =
    metrics.length > 0 ? Math.round(metrics.reduce((a, m) => a + m.score, 0) / metrics.length) : 0

  return (
    <div className="compare-view">
      <div className="compare-head">
        <div>
          <h2>数据源对比</h2>
          <p>
            {metrics.length} 个数据源 · 合计 {int(totalRows)} 行 · 平均质量分 {avgScore}
          </p>
        </div>
        <div className="compare-actions">
          <button className="btn" onClick={onAdd}>
            ＋ 添加数据源
          </button>
        </div>
      </div>

      <div className="compare-grid">
        {metrics.map((m) => (
          <Card
            key={m.id}
            metrics={m}
            maxes={maxes}
            active={m.id === activeId}
            onPick={() => onPick(m.id)}
          />
        ))}
      </div>

      <div className="compare-chart-card">
        <div className="chart-card-head">
          <span className="chart-card-title">缺失率 / 重复率 / 异常率横向对比</span>
          <span className="chart-card-sub">同一条轴，长度可直接横向比较</span>
        </div>
        <div className="chart-card-body">
          <Chart option={chartOption} />
        </div>
      </div>

      <div className="compare-tip">
        点任意卡片切换到该数据源继续清洗；每个数据源的清洗步骤各自独立保存。
      </div>
    </div>
  )
}

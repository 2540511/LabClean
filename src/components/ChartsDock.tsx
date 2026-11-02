import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { EChartsOption } from 'echarts'
import type { Dataset } from '../core/types'
import type { ColumnAnalysis } from '../lib/analyze'
import { formatNumber } from '../core/value'
import { pct, shortNum } from '../lib/format'
import { Chart } from './Chart'

const AXIS = {
  axisLine: { lineStyle: { color: '#e2e8f0' } },
  axisTick: { show: false },
  axisLabel: { color: '#64748b', fontSize: 11 },
  splitLine: { lineStyle: { color: '#f1f5f9' } },
}

/**
 * 数值很大、跨度很小时（如学号 20260101~20260146），
 * 直接把绝对值格式化会让所有刻度都长一样（全是 20.3M）。
 * 这时改用「相对最小值的偏移」做刻度，返回要减掉的基准值。
 */
function axisBase(bins: { x0: number; x1: number }[]): number {
  if (bins.length === 0) return 0
  const base = bins[0].x0
  const span = bins[bins.length - 1].x1 - base
  if (!Number.isFinite(base) || !Number.isFinite(span) || span <= 0) return 0
  if (Math.abs(base) < 1e4) return 0
  return span / Math.abs(base) <= 0.01 ? base : 0
}

function baseLabel(base: number): string {
  return base === 0 ? '' : `刻度 = 实际值 − ${shortNum(base)}`
}

interface Props {
  dataset: Dataset
  selected: number
  analysis: ColumnAnalysis | null
}

function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="chart-card">
      <div className="chart-card-head">
        <span className="chart-card-title">{title}</span>
        {sub ? <span className="chart-card-sub">{sub}</span> : null}
      </div>
      <div className="chart-card-body">{children}</div>
    </div>
  )
}

export function ChartsDock({ dataset, selected, analysis }: Props) {
  const col = dataset.columns[selected]

  const distribOption = useMemo<EChartsOption>(() => {
    if (!col) return {}
    if (analysis) {
      const labels = analysis.bins.map((b) =>
        b.kind === 'low' ? '↓异常' : b.kind === 'high' ? '↑异常' : shortNum((b.x0 + b.x1) / 2),
      )
      const step = Math.max(1, Math.ceil(labels.length / 7))
      return {
        grid: { left: 46, right: 14, top: 14, bottom: 28 },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          formatter: (p: unknown) => {
            const arr = p as { dataIndex: number; value: number }[]
            if (!arr.length) return ''
            const bin = analysis.bins[arr[0].dataIndex]
            if (!bin) return ''
            const range =
              bin.kind === 'normal'
                ? `${shortNum(bin.x0)} ~ ${shortNum(bin.x1)}`
                : bin.kind === 'low'
                  ? `低于正常下界（${shortNum(bin.x1)}）`
                  : `高于正常上界（${shortNum(bin.x0)}）`
            return `${range}<br/><b>${arr[0].value}</b> 个`
          },
        },
        xAxis: {
          type: 'category',
          data: labels,
          ...AXIS,
          axisLabel: {
            ...AXIS.axisLabel,
            interval: (index: number) =>
              analysis.bins[index]?.kind !== 'normal' || index % step === 0,
          },
        },
        yAxis: { type: 'value', ...AXIS },
        series: [
          {
            type: 'bar',
            data: analysis.bins.map((b) => ({
              value: b.count,
              itemStyle: { color: b.kind === 'normal' ? '#2563eb' : '#f59e0b' },
            })),
            itemStyle: { borderRadius: [2, 2, 0, 0] },
            barCategoryGap: '12%',
          },
        ],
      }
    }
    // 文本 / 日期 / 布尔列：高频取值
    const top = col.top.slice(0, 10).slice().reverse()
    return {
      grid: { left: 8, right: 42, top: 10, bottom: 10, containLabel: true },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      xAxis: { type: 'value', ...AXIS },
      yAxis: {
        type: 'category',
        data: top.map((t) => (t.value.length > 12 ? `${t.value.slice(0, 12)}…` : t.value)),
        ...AXIS,
      },
      series: [
        {
          type: 'bar',
          data: top.map((t) => t.count),
          itemStyle: { color: '#0ea5e9', borderRadius: [0, 2, 2, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: '#64748b' },
        },
      ],
    }
  }, [analysis, col])

  const pointsOption = useMemo<EChartsOption>(() => {
    if (!col?.numeric || !analysis) return {}
    const stats = col.numeric
    const normal: [number, number][] = []
    const abnormal: [number, number][] = []
    analysis.points.forEach((v, i) => {
      const jitter = ((i * 0.6180339887) % 1 - 0.5) * 0.55
      const x = 0.5 + jitter
      if (v < analysis.lowFence || v > analysis.highFence) abnormal.push([x, v])
      else normal.push([x, v])
    })

    const lines: Record<string, unknown>[] = []
    const line = (
      y: number,
      color: string,
      type: 'solid' | 'dashed' | 'dotted',
      text: string,
    ) => ({
      yAxis: y,
      lineStyle: { color, type, width: type === 'solid' ? 1.5 : 1.2 },
      label: { formatter: text, fontSize: 10, color, position: 'insideStartTop' },
    })
    if (Number.isFinite(stats.median)) lines.push(line(stats.median, '#2563eb', 'solid', '中位数'))
    if (Number.isFinite(stats.mean)) lines.push(line(stats.mean, '#059669', 'dashed', '均值'))

    // 数据跨数量级时自动切对数轴，否则正常观测点会被极端值压成一条线
    const ratio = stats.min > 0 ? stats.max / stats.min : Infinity
    const useLog = ratio > 20 && Number.isFinite(ratio)

    // 量级大、跨度小时用相对偏移刻度（否则 y 轴每格都是 20.3M）
    const span2 = stats.max - stats.min
    const scatterBase =
      Math.abs(stats.min) >= 1e4 && span2 > 0 && span2 / Math.abs(stats.min) <= 0.01 ? stats.min : 0

    return {
      grid: { left: 48, right: 18, top: 22, bottom: 14 },
      tooltip: {
        trigger: 'item',
        formatter: (p: unknown) => {
          const v = (p as { value?: [number, number] }).value
          return v ? formatNumber(v[1]) : ''
        },
      },
      xAxis: { type: 'value', min: 0, max: 1, show: false },
      yAxis: {
        type: useLog ? 'log' : 'value',
        ...AXIS,
        scale: true,
        // 和直方图一样：量级大、跨度小的时候用相对偏移，否则刻度全糊成一个数
        axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => shortNum(v - scatterBase) },
      },
      series: [
        {
          type: 'scatter',
          name: '观测值',
          data: normal,
          symbolSize: 4,
          itemStyle: { color: 'rgba(37,99,235,0.45)' },
          markLine: {
            silent: true,
            symbol: ['none', 'none'],
            data: lines,
          },
        },
        {
          type: 'scatter',
          name: '异常值',
          data: abnormal,
          symbolSize: 5,
          itemStyle: { color: '#dc2626' },
        },
      ],
    } as EChartsOption
  }, [analysis, col])

  const missingOption = useMemo<EChartsOption>(() => {
    const list = dataset.columns
      .filter((c) => c.missing > 0)
      .sort((a, b) => b.missingRate - a.missingRate)
      .slice(0, 12)
      .reverse()
    if (list.length === 0) return {}
    return {
      grid: { left: 8, right: 48, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: unknown) => {
          const arr = p as { name: string; value: number }[]
          return arr.length > 0 ? `${arr[0].name}<br/>缺失率 ${pct(arr[0].value, 2)}` : ''
        },
      },
      xAxis: { type: 'value', ...AXIS, axisLabel: { ...AXIS.axisLabel, formatter: (v: number) => `${(v * 100).toFixed(0)}%` }, max: 1 },
      yAxis: { type: 'category', data: list.map((c) => c.name), ...AXIS },
      series: [
        {
          type: 'bar',
          data: list.map((c) => c.missingRate),
          itemStyle: { color: '#f59e0b', borderRadius: [0, 2, 2, 0] },
          label: {
            show: true,
            position: 'right',
            fontSize: 10,
            color: '#b45309',
            formatter: (p: { value?: unknown }) => pct(Number(p.value ?? 0), 1),
          },
        },
      ],
    }
  }, [dataset.columns])

  if (!col) {
    return (
      <div className="charts-dock">
        <Card title="图表">
          <div className="chart-empty">在左侧点一列，这里就会画出它的分布</div>
        </Card>
      </div>
    )
  }

  return (
    <div className="charts-dock">
      <Card
        title={analysis ? '分布直方图' : '高频取值'}
        sub={
          analysis
            ? `分 ${analysis.bins.length} 组${baseLabel(axisBase(analysis.bins)) ? ` · ${baseLabel(axisBase(analysis.bins))}` : ''}`
            : `Top ${Math.min(10, col.top.length)}`
        }
      >
        {analysis || col.top.length > 0 ? (
          <Chart option={distribOption} />
        ) : (
          <div className="chart-empty">这一列没有可画的数据</div>
        )}
      </Card>

      <Card
        title="观测点分布"
        sub={
          col.numeric
            ? `中位数 ${formatNumber(col.numeric.median)} · 异常 ${col.numeric.outliers}`
            : '仅数值列可用'
        }
      >
        {col.numeric && analysis ? <Chart option={pointsOption} /> : <div className="chart-empty">文本列不画散点</div>}
      </Card>

      <Card title="各列缺失率" sub="最高的 12 列">
        {missingOption.series ? <Chart option={missingOption} /> : <div className="chart-empty">没有缺失值，很干净</div>}
      </Card>
    </div>
  )
}

import { useMemo } from 'react'
import type { EChartsOption } from 'echarts'
import type { Dataset } from '../core/types'
import { KIND_LABEL, classifyFields, recommendCharts, type ChartPlan } from '../core/recommend'
import { analyzeColumn, type ColumnAnalysis } from '../lib/analyze'
import { scatterSeries, timeSeries } from '../lib/series'
import { shortNum } from '../lib/format'
import { Chart } from './Chart'

const AXIS = {
  axisLine: { lineStyle: { color: '#e2e8f0' } },
  axisTick: { show: false },
  axisLabel: { color: '#64748b', fontSize: 11 },
  splitLine: { lineStyle: { color: '#f1f5f9' } },
}

const ACCENT = '#2563eb'
const AMBER = '#f59e0b'
const DANGER = '#dc2626'

/** time 轴的刻度：只显示月/日，避免echarts默认把完整时间都印出来 */
function shortDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

interface Built {
  option: EChartsOption
  sub?: string
  empty?: string
}

function buildHistogram(analysis: ColumnAnalysis | null): Built {
  if (!analysis || analysis.bins.length === 0) {
    return { option: {}, empty: '这一列没有可画分布的数值' }
  }
  const labels = analysis.bins.map((b) =>
    b.kind === 'low' ? '↓离群' : b.kind === 'high' ? '↑离群' : shortNum((b.x0 + b.x1) / 2),
  )
  const step = Math.max(1, Math.ceil(labels.length / 8))
  return {
    option: {
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
            itemStyle: { color: b.kind === 'normal' ? ACCENT : AMBER },
          })),
          itemStyle: { borderRadius: [2, 2, 0, 0] },
          barCategoryGap: '12%',
        },
      ],
    } as EChartsOption,
    sub: `分 ${analysis.bins.length} 组`,
  }
}

function buildBoxplot(dataset: Dataset, plan: ChartPlan, analysis: ColumnAnalysis | null): Built {
  const stats = dataset.columns[plan.colIndex]?.numeric
  if (!stats || !Number.isFinite(stats.median)) {
    return { option: {}, empty: '这一列没有足够的数值画箱线图' }
  }
  const q1 = stats.q1
  const q3 = stats.q3
  const wLow = Math.min(
    q1,
    Number.isFinite(stats.lowFence) ? Math.max(stats.min, stats.lowFence) : stats.min,
  )
  const wHigh = Math.max(
    q3,
    Number.isFinite(stats.highFence) ? Math.min(stats.max, stats.highFence) : stats.max,
  )

  // 用体检时一次性收集的真实离群值（最多 500 个），不再从 600 点抽样里挑：
  // 否则图上点数会和「离群点 N 个」的标题对不上
  const outliers = analysis?.outlierValues ?? []

  return {
    option: {
      grid: { left: 52, right: 18, top: 16, bottom: 24 },
      tooltip: {
        trigger: 'item',
        formatter: (p: unknown) => {
          const item = p as { seriesType: string; data: unknown }
          if (item.seriesType === 'boxplot') {
            return `最小 ${shortNum(wLow)}<br/>Q1 ${shortNum(q1)}<br/>中位数 ${shortNum(
              stats.median,
            )}<br/>Q3 ${shortNum(q3)}<br/>最大 ${shortNum(wHigh)}`
          }
          const v = (item.data as [number, number] | undefined)?.[1]
          return v === undefined ? '' : `离群点 ${shortNum(v)}`
        },
      },
      xAxis: {
        type: 'category',
        data: [plan.colName],
        ...AXIS,
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        ...AXIS,
        scale: true,
        axisLabel: { ...AXIS.axisLabel, formatter: shortNum },
      },
      series: [
        {
          type: 'boxplot',
          name: plan.colName,
          data: [[wLow, q1, stats.median, q3, wHigh]],
          itemStyle: { color: '#eff6ff', borderColor: ACCENT, borderWidth: 1.5 },
          boxWidth: [24, 46],
        },
        {
          type: 'scatter',
          name: '离群点',
          data: outliers.map((v) => [0, v] as [number, number]),
          symbolSize: 5,
          itemStyle: { color: 'rgba(220,38,38,0.7)' },
        },
      ],
    } as EChartsOption,
    sub: `离群点 ${stats.outliers} 个${
      stats.outliers > outliers.length ? `（图上显示前 ${outliers.length} 个）` : ''
    }`,
  }
}

function buildBar(dataset: Dataset, plan: ChartPlan): Built {
  const col = dataset.columns[plan.colIndex]
  if (!col || col.top.length === 0) return { option: {}, empty: '这一列没有可统计的类别' }
  const rows = col.top.slice(0, 12).slice().reverse()
  const total = rows.reduce((s, t) => s + t.count, 0)
  return {
    option: {
      grid: { left: 8, right: 46, top: 10, bottom: 10, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (p: unknown) => {
          const arr = p as { name: string; value: number }[]
          if (!arr.length) return ''
          const share = total > 0 ? ((arr[0].value / total) * 100).toFixed(1) : '0'
          return `${arr[0].name}<br/><b>${arr[0].value}</b> 个 · 占 ${share}%`
        },
      },
      xAxis: { type: 'value', ...AXIS },
      yAxis: {
        type: 'category',
        data: rows.map((t) => (t.value.length > 12 ? `${t.value.slice(0, 12)}…` : t.value)),
        ...AXIS,
      },
      series: [
        {
          type: 'bar',
          data: rows.map((t) => t.count),
          itemStyle: { color: '#0ea5e9', borderRadius: [0, 2, 2, 0] },
          label: { show: true, position: 'right', fontSize: 10, color: '#64748b' },
        },
      ],
    } as EChartsOption,
    sub: `${col.distinct} 个类别 · Top ${rows.length}`,
  }
}

function buildLine(dataset: Dataset, plan: ChartPlan, summaryRows: Set<number>): Built {
  if (plan.secondIndex === undefined) return { option: {}, empty: '缺少数值列，画不了趋势' }
  const pts = timeSeries(dataset.rows, plan.colIndex, plan.secondIndex, 160, summaryRows)
  if (pts.length === 0) return { option: {}, empty: '没有可用的「时间 + 数值」行' }
  return {
    option: {
      grid: { left: 48, right: 18, top: 16, bottom: 34 },
      tooltip: {
        trigger: 'axis',
        formatter: (p: unknown) => {
          const arr = p as { axisValueLabel?: string; value?: [number, number | null] }[]
          if (!arr.length) return ''
          const v = arr[0].value?.[1] ?? null
          return `${arr[0].axisValueLabel ?? ''}<br/>${plan.secondName} 均值 <b>${v === null ? '—' : shortNum(v)}</b>`
        },
      },
      xAxis: {
        // 用 time 轴而不是 category：日期间隔不均匀时，间距才是真的
        type: 'time',
        ...AXIS,
        axisLabel: {
          ...AXIS.axisLabel,
          hideOverlap: true,
          formatter: (v: number) => shortDate(v),
        },
      },
      yAxis: {
        type: 'value',
        ...AXIS,
        scale: true,
        axisLabel: { ...AXIS.axisLabel, formatter: shortNum },
      },
      series: [
        {
          type: 'line',
          name: plan.secondName,
          data: pts.map((p) => [p.ts, p.value]),
          smooth: true,
          showSymbol: pts.length <= 60,
          symbolSize: 4,
          connectNulls: false,
          lineStyle: { color: ACCENT, width: 2 },
          itemStyle: { color: ACCENT },
          areaStyle: { color: 'rgba(37,99,235,0.10)' },
        },
      ],
    } as EChartsOption,
    sub: `${pts.length} 个时间点`,
  }
}

function buildScatter(dataset: Dataset, plan: ChartPlan, summaryRows: Set<number>): Built {
  if (plan.secondIndex === undefined) return { option: {}, empty: '需要两个数值列' }
  const res = scatterSeries(dataset.rows, plan.colIndex, plan.secondIndex, 800, summaryRows)
  if (res.points.length === 0) return { option: {}, empty: '两列没有同时为数值的行' }

  const { line } = res
  const series = [
    {
      type: 'scatter',
      name: '观测点',
      data: res.points,
      symbolSize: 5,
      itemStyle: { color: 'rgba(37,99,235,0.5)' },
    },
    ...(line
      ? [
          {
            type: 'line',
            name: '回归线',
            data: [
              [line.x0, line.slope * line.x0 + line.intercept],
              [line.x1, line.slope * line.x1 + line.intercept],
            ],
            showSymbol: false,
            lineStyle: { color: DANGER, type: 'dashed', width: 1.5 },
          },
        ]
      : []),
  ]

  const rText = Number.isFinite(res.r) ? res.r.toFixed(3) : '—'
  return {
    option: {
      grid: { left: 52, right: 18, top: 16, bottom: 34 },
      tooltip: {
        trigger: 'item',
        formatter: (p: unknown) => {
          const item = p as { seriesType: string; value?: [number, number] }
          if (item.seriesType !== 'scatter' || !item.value) return ''
          return `${plan.colName} ${shortNum(item.value[0])}<br/>${plan.secondName} ${shortNum(item.value[1])}`
        },
      },
      xAxis: {
        type: 'value',
        name: plan.colName,
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: '#64748b', fontSize: 11 },
        ...AXIS,
        scale: true,
        axisLabel: { ...AXIS.axisLabel, formatter: shortNum },
      },
      yAxis: {
        type: 'value',
        name: plan.secondName,
        nameTextStyle: { color: '#64748b', fontSize: 11 },
        ...AXIS,
        scale: true,
        axisLabel: { ...AXIS.axisLabel, formatter: shortNum },
      },
      series,
    } as unknown as EChartsOption,
    sub: `相关系数 r = ${rText}`,
  }
}

function RecCard({
  plan,
  dataset,
  analysis,
  summaryRows,
}: {
  plan: ChartPlan
  dataset: Dataset
  analysis: ColumnAnalysis | null
  summaryRows: Set<number>
}) {
  const built = useMemo<Built>(() => {
    switch (plan.kind) {
      case 'histogram':
        return buildHistogram(analysis)
      case 'boxplot':
        return buildBoxplot(dataset, plan, analysis)
      case 'bar':
        return buildBar(dataset, plan)
      case 'line':
        return buildLine(dataset, plan, summaryRows)
      case 'scatter':
        return buildScatter(dataset, plan, summaryRows)
    }
  }, [plan, dataset, analysis, summaryRows])

  return (
    <div className="chart-card rec-card">
      <div className="chart-card-head">
        <span className="chart-card-title">
          {KIND_LABEL[plan.kind]}
          {built.sub ? <span className="rec-sub"> · {built.sub}</span> : null}
        </span>
        <span className="rec-scenario">{plan.scenario}</span>
      </div>
      <div className="rec-reason">{plan.reason}</div>
      <div className="chart-card-body">
        {built.empty ? <div className="chart-empty">{built.empty}</div> : <Chart option={built.option} />}
      </div>
    </div>
  )
}

export function InsightsView({ dataset }: { dataset: Dataset }) {
  const fields = useMemo(() => classifyFields(dataset), [dataset])
  const plans = useMemo(() => recommendCharts(dataset), [dataset])

  /** 合计/统计行不参与分布与相关性：和主界面、体检保持同一口径 */
  const summaryRows = useMemo(
    () => new Set<number>(dataset.meta.summaryRowIndexes ?? []),
    [dataset],
  )

  // 直方图 / 箱线图会用到同一列的分箱结果，预先按列算一次，避免每张卡都重扫全表
  const analyses = useMemo(() => {
    const map = new Map<number, ColumnAnalysis | null>()
    for (const p of plans) {
      if (p.kind !== 'histogram' && p.kind !== 'boxplot') continue
      if (!map.has(p.colIndex)) {
        map.set(
          p.colIndex,
          analyzeColumn(dataset.rows, dataset.columns[p.colIndex], undefined, summaryRows),
        )
      }
    }
    return map
  }, [plans, dataset, summaryRows])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const f of fields) c[f.roleLabel] = (c[f.roleLabel] ?? 0) + 1
    return c
  }, [fields])

  return (
    <div className="insights-view">
      <div className="insights-head">
        <h2>智能推荐图表</h2>
        <p>
          已自动识别 {fields.length} 个字段的类型，按「数据场景 → 图表」规则生成 {plans.length} 张最合适的可视化
        </p>
      </div>

      <div className="field-summary">
        <div className="field-summary-counts">
          {Object.entries(counts).map(([label, n]) => (
            <span className="fs-count" key={label}>
              {label} <b>{n}</b>
            </span>
          ))}
        </div>
        <div className="field-chips">
          {fields.map((f) => (
            <span
              className={`field-chip role-${f.role}`}
              key={f.index}
              title={`唯一值约 ${f.distinct}`}
            >
              <span className="fc-name">{f.name}</span>
              <span className="fc-role">{f.roleLabel}</span>
            </span>
          ))}
        </div>
      </div>

      {plans.length === 0 ? (
        <div className="chart-empty insights-empty">
          这份数据没有适合自动可视化的字段（需要至少一个数值、类别或时间列）
        </div>
      ) : (
        <div className="insights-grid">
          {plans.map((p) => (
            <RecCard
              key={p.id}
              plan={p}
              dataset={dataset}
              analysis={analyses.get(p.colIndex) ?? null}
              summaryRows={summaryRows}
            />
          ))}
        </div>
      )}
    </div>
  )
}

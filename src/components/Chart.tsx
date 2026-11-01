import { useEffect, useRef } from 'react'
import * as echarts from 'echarts'
import type { EChartsOption } from 'echarts'

interface Props {
  option: EChartsOption
  className?: string
}

/** 极简 ECharts 包装：负责初始化、尺寸自适应和销毁 */
export function Chart({ option, className }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return
    const instance = echarts.init(el, undefined, { renderer: 'canvas' })
    chartRef.current = instance
    const ro = new ResizeObserver(() => instance.resize())
    ro.observe(el)
    return () => {
      ro.disconnect()
      instance.dispose()
      chartRef.current = null
    }
  }, [])

  useEffect(() => {
    chartRef.current?.setOption(option, true)
  }, [option])

  return <div ref={hostRef} className={className ?? 'chart-host'} />
}

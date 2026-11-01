import { buildDataset } from './profile'
import type { CellValue, Dataset } from './types'

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

/**
 * 内置示例数据：故意做「脏」——缺失、极端值、多余空格、重复行、前导零编号都有。
 * 用于比赛演示和第一次上手，点一下就能看到完整体检 + 清洗效果。
 */
export function buildDemoDataset(): Dataset {
  const rows: CellValue[][] = [['样品编号', '温度(℃)', '浓度(mg/L)', '重复次数', '采样日期', '备注']]

  // 固定种子的线性同余，保证每次生成的示例数据完全一致
  let seed = 20240301
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const gauss = (): number => {
    const u = Math.max(rnd(), 1e-9)
    const v = rnd()
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }

  for (let i = 0; i < 240; i++) {
    const sample = `S${pad(i + 1, 4)}`
    let temp: number | null = Number((25 + gauss() * 0.55).toFixed(2))
    if (i % 41 === 7) temp = 999 // 明显异常值
    if (i % 13 === 0) temp = null // 缺失
    const conc = Number((12.5 + Math.sin(i / 9) * 1.8 + gauss() * 0.12).toFixed(2))
    const repeat = (i % 3) + 1
    const day = new Date(2024, 2, 1 + Math.floor(i / 12))
    const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
    const note = i % 23 === 0 ? '  偏高  ' : i % 19 === 0 ? null : i % 11 === 0 ? '待复测' : '正常'
    rows.push([sample, temp, conc, repeat, date, note])
  }

  // 两条完全重复的行
  rows.push([...(rows[1] as CellValue[])])
  rows.push([...(rows[6] as CellValue[])])

  const started = performance.now()
  return buildDataset('实验数据示例.xlsx', '数据', rows, {
    source: '内置示例数据',
    elapsedMs: performance.now() - started,
  })
}

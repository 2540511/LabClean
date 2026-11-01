import { buildDataset } from './profile'
import type { CellValue, Dataset } from './types'

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0')
}

interface Knobs {
  rowCount: number
  seed: number
  missingEvery: number
  outlierEvery: number
  dirtyNote: boolean
  duplicateRows: number
}

function makeRows(k: Knobs): CellValue[][] {
  const rows: CellValue[][] = [['样品编号', '温度(℃)', '浓度(mg/L)', '重复次数', '采样日期', '备注']]

  let seed = k.seed
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const gauss = (): number => {
    const u = Math.max(rnd(), 1e-9)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
  }

  for (let i = 0; i < k.rowCount; i++) {
    const sample = `S${pad(i + 1, 4)}`
    let temp: number | null = Number((25 + gauss() * 0.55).toFixed(2))
    if (k.outlierEvery > 0 && i % k.outlierEvery === 7) temp = 999
    if (k.missingEvery > 0 && i % k.missingEvery === 0) temp = null
    const conc = Number((12.5 + Math.sin(i / 9) * 1.8 + gauss() * 0.12).toFixed(2))
    const repeat = (i % 3) + 1
    const day = new Date(2024, 2, 1 + Math.floor(i / 12))
    const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
    const note = !k.dirtyNote
      ? '正常'
      : i % 23 === 0
        ? '  偏高  '
        : i % 19 === 0
          ? null
          : i % 11 === 0
            ? '待复测'
            : '正常'
    rows.push([sample, temp, conc, repeat, date, note])
  }

  for (let d = 0; d < k.duplicateRows; d++) {
    const pick = rows[1 + d * 5]
    if (pick) rows.push([...(pick as CellValue[])])
  }
  return rows
}

function build(name: string, sheet: string, k: Knobs): Dataset {
  const started = performance.now()
  return buildDataset(name, sheet, makeRows(k), {
    source: '内置示例数据',
    elapsedMs: performance.now() - started,
  })
}

/**
 * 三个质量不同的示例数据源，用来演示「多数据源对比」。
 * 第一个故意做脏（缺失 / 极端值 / 空格 / 重复 / 前导零编号），后两个越来越干净。
 */
export function buildDemoDatasets(): Dataset[] {
  return [
    build('实验原始记录.xlsx', '原始记录', {
      rowCount: 240,
      seed: 20240301,
      missingEvery: 13,
      outlierEvery: 41,
      dirtyNote: true,
      duplicateRows: 2,
    }),
    build('复测数据.xlsx', '复测', {
      rowCount: 96,
      seed: 771003,
      missingEvery: 0,
      outlierEvery: 0,
      dirtyNote: false,
      duplicateRows: 0,
    }),
    build('批次汇总.xlsx', '批次汇总', {
      rowCount: 24,
      seed: 424242,
      missingEvery: 17,
      outlierEvery: 0,
      dirtyNote: false,
      duplicateRows: 0,
    }),
  ]
}

/** 兼容旧调用：只取第一个数据集 */
export function buildDemoDataset(): Dataset {
  return buildDemoDatasets()[0]
}

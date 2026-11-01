// 生成一份可以直接拖进应用里试的示例 Excel（含两个工作表、故意做脏）。
// 用法：node scripts/make-sample.mjs
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as XLSX from 'xlsx'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const outDir = join(root, 'samples')
mkdirSync(outDir, { recursive: true })

let seed = 20240301
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
const gauss = () => {
  const u = Math.max(rnd(), 1e-9)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
}
const pad = (n, w = 2) => String(n).padStart(w, '0')

const rows = [['样品编号', '温度(℃)', '浓度(mg/L)', '重复次数', '采样日期', '备注']]
for (let i = 0; i < 5000; i++) {
  const sample = `S${pad(i + 1, 4)}`
  let temp = Number((25 + gauss() * 0.55).toFixed(2))
  if (i % 41 === 7) temp = 999
  if (i % 13 === 0) temp = null
  const conc = Number((12.5 + Math.sin(i / 9) * 1.8 + gauss() * 0.12).toFixed(2))
  const repeat = (i % 3) + 1
  const day = new Date(2024, 2, 1 + Math.floor(i / 40))
  const date = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`
  const note = i % 23 === 0 ? '  偏高  ' : i % 19 === 0 ? null : i % 11 === 0 ? '待复测' : '正常'
  rows.push([sample, temp, conc, repeat, date, note])
}
rows.push([...rows[1]])
rows.push([...rows[6]])

const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '原始记录')

// 第二个工作表，用来演示多表切换
const summary = [['批次', '样本数', '平均温度', '负责人']]
for (let b = 1; b <= 6; b++) {
  summary.push([`B${pad(b)}`, 800 + b * 12, Number((24.8 + b * 0.1).toFixed(2)), ['张', '李', '王'][b % 3]])
}
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), '批次汇总')

const out = join(outDir, '实验数据示例.xlsx')
XLSX.writeFile(wb, out)
console.log(`已生成 ${out}（原始记录 ${rows.length - 1} 行 + 批次汇总）`)

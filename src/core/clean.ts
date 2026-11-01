import type { CellValue, Column } from './types'
import { coerceNumber, isBlank, rawText } from './value'

export interface OpResult {
  rows: CellValue[][]
  affected: number
  detail: string
  /** 过滤类算子返回保留下来的行下标（按原顺序），值类算子不返回 */
  kept?: number[]
}

/**
 * 所有算子都是「写时复制」：
 * 只有真正被改动的行才复制一份新数组，其余行保持原对象引用。
 * 这样原始数据（baseline）永远不会被破坏，撤销只要重放即可，
 * 内存开销只和「改了多少」成正比，而不是和表有多大成正比。
 */

const EDGE_SPACE_RE = /^[\s\u00a0\u3000]+|[\s\u00a0\u3000]+$/g

export function opTrimWhitespace(rows: CellValue[][], columns: Column[]): OpResult {
  const next = rows.slice()
  let affected = 0
  for (let r = 0; r < next.length; r++) {
    const row = next[r]
    let copy: CellValue[] | null = null
    for (const col of columns) {
      const v = row[col.index]
      if (typeof v !== 'string') continue
      const trimmed = v.replace(EDGE_SPACE_RE, '')
      if (trimmed === v) continue
      if (!copy) copy = row.slice()
      copy[col.index] = trimmed
      affected++
    }
    if (copy) next[r] = copy
  }
  return { rows: next, affected, detail: `清理了 ${affected} 个单元格的首尾空格` }
}

export type FillStrategy = 'mean' | 'median' | 'mode' | 'zero' | 'text'

export const FILL_LABEL: Record<FillStrategy, string> = {
  mean: '用平均值填充',
  median: '用中位数填充',
  mode: '用出现最多的值填充',
  zero: '填 0',
  text: '填「未填写」',
}

/** 把策略解析成具体填充值（在「当前状态」的列统计上算，然后记进操作里，重放才可复现） */
export function resolveFillValue(col: Column, strategy: FillStrategy, custom?: string): CellValue {
  switch (strategy) {
    case 'mean':
      return col.numeric && Number.isFinite(col.numeric.mean) ? col.numeric.mean : null
    case 'median':
      return col.numeric && Number.isFinite(col.numeric.median) ? col.numeric.median : null
    case 'zero':
      return 0
    case 'mode':
      return col.top.length > 0 ? col.top[0].value : null
    case 'text':
      return custom && custom.length > 0 ? custom : '未填写'
  }
}

export function opFillMissing(
  rows: CellValue[][],
  colIndex: number,
  colName: string,
  value: CellValue,
): OpResult {
  if (value === null || value === undefined) {
    return { rows, affected: 0, detail: '没有可用的填充值' }
  }
  const next = rows.slice()
  let affected = 0
  for (let r = 0; r < next.length; r++) {
    const row = next[r]
    if (!isBlank(row[colIndex])) continue
    const copy = row.slice()
    copy[colIndex] = value
    next[r] = copy
    affected++
  }
  return {
    rows: next,
    affected,
    detail:
      affected === 0
        ? `「${colName}」没有空值`
        : `「${colName}」填充了 ${affected} 个空单元格 → ${rawText(value)}`,
  }
}

export function opDropDuplicateRows(rows: CellValue[][], columns: Column[]): OpResult {
  const seen = new Set<string>()
  const kept: CellValue[][] = []
  const keptIdx: number[] = []
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    let key = ''
    for (const col of columns) {
      key += rawText(row[col.index] ?? null)
      key += '\u0001'
    }
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(row)
    keptIdx.push(i)
  }
  const affected = rows.length - kept.length
  return {
    rows: kept,
    kept: keptIdx,
    affected,
    detail: `删除了 ${affected} 行完全重复的数据`,
  }
}

export function opDropEmptyRows(rows: CellValue[][]): OpResult {
  const kept: CellValue[][] = []
  const keptIdx: number[] = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].some((v) => !isBlank(v))) {
      kept.push(rows[i])
      keptIdx.push(i)
    }
  }
  const affected = rows.length - kept.length
  return { rows: kept, kept: keptIdx, affected, detail: `删除了 ${affected} 行全空行` }
}

/** 把带千分位/全角字符的文本列转成真正的数字列 */
export function opNormalizeNumbers(rows: CellValue[][], colIndex: number, colName: string): OpResult {
  const next = rows.slice()
  let affected = 0
  for (let r = 0; r < next.length; r++) {
    const row = next[r]
    const v = row[colIndex]
    if (typeof v === 'number' || isBlank(v)) continue
    const n = coerceNumber(v)
    if (n === null) continue
    const copy = row.slice()
    copy[colIndex] = n
    next[r] = copy
    affected++
  }
  return { rows: next, affected, detail: `「${colName}」有 ${affected} 个值转成了数字` }
}

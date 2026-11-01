import type { CellValue, Column } from './types'
import { coerceNumber, isBlank, rawText } from './value'

export interface OpResult {
  rows: CellValue[][]
  affected: number
  detail: string
}

/**
 * 说明：这里的算子**就地修改** rows（不复制整表），
 * 因为复制百万行会直接吃掉几百 MB 内存。
 * 原始文件永远不动，需要回到初始状态时重新解析源文件即可。
 */

const EDGE_SPACE_RE = /^[\s\u00a0\u3000]+|[\s\u00a0\u3000]+$/g

export function opTrimWhitespace(rows: CellValue[][], columns: Column[]): OpResult {
  let affected = 0
  for (const row of rows) {
    for (const col of columns) {
      const v = row[col.index]
      if (typeof v !== 'string') continue
      const t = v.replace(EDGE_SPACE_RE, '')
      if (t !== v) {
        row[col.index] = t
        affected++
      }
    }
  }
  return { rows, affected, detail: `清理了 ${affected} 个单元格的首尾空格` }
}

export type FillStrategy = 'mean' | 'median' | 'mode' | 'zero' | 'custom' | 'text'

export function suggestFillValue(col: Column, strategy: FillStrategy, custom = ''): CellValue {
  switch (strategy) {
    case 'mean':
      return col.numeric && Number.isFinite(col.numeric.mean) ? col.numeric.mean : null
    case 'median':
      return col.numeric && Number.isFinite(col.numeric.median) ? col.numeric.median : null
    case 'zero':
      return 0
    case 'mode':
      return col.top.length > 0 ? col.top[0].value : null
    case 'custom':
      return custom === '' ? null : custom
    case 'text':
      return '未填写'
  }
}

export function opFillMissing(
  rows: CellValue[][],
  col: Column,
  strategy: FillStrategy,
  custom = '',
): OpResult {
  const fill = suggestFillValue(col, strategy, custom)
  if (fill === null) return { rows, affected: 0, detail: '没有可用的填充值' }

  let affected = 0
  for (const row of rows) {
    const v = row[col.index]
    if (!isBlank(v)) continue
    row[col.index] = typeof fill === 'number' ? fill : fill
    affected++
  }
  return {
    rows,
    affected,
    detail: `「${col.name}」填充了 ${affected} 个空单元格 → ${rawText(fill)}`,
  }
}

export function opDropDuplicateRows(rows: CellValue[][], columns: Column[]): OpResult {
  const seen = new Set<string>()
  const kept: CellValue[][] = []
  for (const row of rows) {
    let key = ''
    for (const col of columns) {
      key += rawText(row[col.index] ?? null)
      key += '\u0001'
    }
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(row)
  }
  const affected = rows.length - kept.length
  return { rows: kept, affected, detail: `删除了 ${affected} 行完全重复的数据` }
}

export function opDropEmptyRows(rows: CellValue[][]): OpResult {
  const kept = rows.filter((row) => row.some((v) => !isBlank(v)))
  const affected = rows.length - kept.length
  return { rows: kept, affected, detail: `删除了 ${affected} 行全空行` }
}

/** 把带千分位/全角字符的文本列转成真正的数字列 */
export function opNormalizeNumbers(rows: CellValue[][], col: Column): OpResult {
  let affected = 0
  for (const row of rows) {
    const v = row[col.index]
    if (typeof v === 'number') continue
    if (isBlank(v)) continue
    const n = coerceNumber(v)
    if (n !== null) {
      row[col.index] = n
      affected++
    }
  }
  return { rows, affected, detail: `「${col.name}」有 ${affected} 个值转成了数字` }
}

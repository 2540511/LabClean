import type { CellValue, Dataset } from '../core/types'
import { isBlank } from '../core/value'

export interface DatasetDiff {
  changedCells: number
  changedByColumn: number[]
  removedRows: number
}

export function sameCell(a: CellValue, b: CellValue): boolean {
  const ab = a === null || a === undefined
  const bb = b === null || b === undefined
  if (ab || bb) return ab && bb
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (isBlank(a) && isBlank(b)) return true
  return a === b
}

/** 逐格对比：当前数据和它的原始来源（通过 origins 对齐，所以删行也不会错位） */
export function computeDiff(
  baseline: Dataset,
  rows: CellValue[][],
  origins: number[],
  headers?: string[],
): DatasetDiff {
  const colCount = headers?.length ?? baseline.columns.length
  const changedByColumn = new Array<number>(colCount).fill(0)
  let changedCells = 0

  // 列被删除/重排后，当前第 i 列在原始数据里可能是另一列，按列名对回去再比
  const sourceIndex = new Array<number>(colCount)
  for (let c = 0; c < colCount; c++) {
    const name = headers?.[c]
    const found = name === undefined ? -1 : baseline.columns.findIndex((col) => col.name === name)
    sourceIndex[c] = found >= 0 ? found : c
  }

  for (let r = 0; r < rows.length; r++) {
    const source = baseline.rows[origins[r]]
    if (!source) continue
    const row = rows[r]
    for (let c = 0; c < colCount; c++) {
      if (!sameCell(source[sourceIndex[c]] ?? null, row[c] ?? null)) {
        changedByColumn[c]++
        changedCells++
      }
    }
  }

  return {
    changedCells,
    changedByColumn,
    removedRows: Math.max(0, baseline.rows.length - rows.length),
  }
}

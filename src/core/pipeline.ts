import type { CellValue, Column } from './types'
import {
  FILL_LABEL,
  opDropDuplicateRows,
  opDropEmptyRows,
  opFillMissing,
  opNormalizeNumbers,
  opTrimWhitespace,
  type FillStrategy,
} from './clean'

/** 一步清洗动作的完整描述：只带数据，不带函数，所以可序列化、可重放、可存模板 */
export type OpSpec =
  | { kind: 'trim' }
  | {
      kind: 'fillMissing'
      colIndex: number
      colName: string
      strategy: FillStrategy
      /** 解析后的具体填充值（重放时不依赖当时的统计量） */
      value: CellValue
    }
  | { kind: 'dropDuplicates' }
  | { kind: 'dropEmptyRows' }
  | { kind: 'normalizeNumbers'; colIndex: number; colName: string }

export interface StepOutcome {
  rows: CellValue[][]
  /** 当前每行来自原始数据的第几行，用来做逐格对比 */
  origins: number[]
  affected: number
  detail: string
}

/** 一条已执行的清洗步骤，同时保存「怎么做的」和「给人看的说明」 */
export interface StepRecord {
  id: string
  at: number
  spec: OpSpec
  title: string
  detail: string
  affected: number
}

export function makeStepId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`
}

/** 在原始数据上顺序跑完一组步骤，返回步骤记录和最终状态 */
export function buildStepSequence(
  baselineRows: CellValue[][],
  columns: Column[],
  specs: OpSpec[],
): { steps: StepRecord[]; rows: CellValue[][]; origins: number[] } {
  let rows = baselineRows
  let origins = baselineRows.map((_, i) => i)
  const steps: StepRecord[] = []
  for (const spec of specs) {
    const out = applySpec(rows, origins, columns, spec)
    steps.push({
      id: makeStepId(),
      at: Date.now(),
      spec,
      title: opTitle(spec),
      detail: out.detail,
      affected: out.affected,
    })
    rows = out.rows
    origins = out.origins
  }
  return { steps, rows, origins }
}

export function opTitle(spec: OpSpec): string {
  switch (spec.kind) {
    case 'trim':
      return '清理首尾空格'
    case 'fillMissing':
      return `填充缺失（${FILL_LABEL[spec.strategy]}）`
    case 'dropDuplicates':
      return '删除重复行'
    case 'dropEmptyRows':
      return '删除全空行'
    case 'normalizeNumbers':
      return '数字规范化'
  }
}

/** 在给定状态上执行一步，返回新状态（不修改入参） */
export function applySpec(
  rows: CellValue[][],
  origins: number[],
  columns: Column[],
  spec: OpSpec,
): StepOutcome {
  switch (spec.kind) {
    case 'trim': {
      const r = opTrimWhitespace(rows, columns)
      return { rows: r.rows, origins, affected: r.affected, detail: r.detail }
    }
    case 'fillMissing': {
      const r = opFillMissing(rows, spec.colIndex, spec.colName, spec.value)
      return { rows: r.rows, origins, affected: r.affected, detail: r.detail }
    }
    case 'normalizeNumbers': {
      const r = opNormalizeNumbers(rows, spec.colIndex, spec.colName)
      return { rows: r.rows, origins, affected: r.affected, detail: r.detail }
    }
    case 'dropDuplicates': {
      const r = opDropDuplicateRows(rows, columns)
      const kept = r.kept ?? rows.map((_, i) => i)
      return {
        rows: r.rows,
        origins: kept.map((i) => origins[i]),
        affected: r.affected,
        detail: r.detail,
      }
    }
    case 'dropEmptyRows': {
      const r = opDropEmptyRows(rows)
      const kept = r.kept ?? rows.map((_, i) => i)
      return {
        rows: r.rows,
        origins: kept.map((i) => origins[i]),
        affected: r.affected,
        detail: r.detail,
      }
    }
  }
}

/**
 * 从原始数据出发，依次重放前 n 步。
 * 撤销 = 少重放一步；重做 = 多重放一步；改动步骤 = 截断后追加。
 */
export function replay(
  baselineRows: CellValue[][],
  columns: Column[],
  specs: OpSpec[],
): StepOutcome {
  let rows = baselineRows
  let origins: number[] | null = null
  for (const spec of specs) {
    if (!origins) origins = baselineRows.map((_, i) => i)
    const out = applySpec(rows, origins, columns, spec)
    rows = out.rows
    origins = out.origins
  }
  return {
    rows,
    origins: origins ?? baselineRows.map((_, i) => i),
    affected: 0,
    detail: '',
  }
}

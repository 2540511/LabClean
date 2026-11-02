import type { CellValue, Column } from './types'
import {
  FILL_LABEL,
  FILTER_LABEL,
  opDropColumn,
  opDropDuplicateRows,
  opDropEmptyRows,
  opFilterRows,
  opFillMissing,
  opMoveColumn,
  opNormalizeNumbers,
  opRenameColumn,
  opTrimWhitespace,
  type FillStrategy,
  type FilterOp,
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
  | {
      kind: 'fuzzyDedupe'
      colIndex: number
      colName: string
      threshold: number
      /** 扫描时算好的待删行下标：重放时直接用，结果才稳定 */
      dropRows: number[]
    }
  | { kind: 'filterRows'; colIndex: number; colName: string; op: FilterOp; value: string }
  | { kind: 'dropColumn'; colIndex: number; colName: string }
  | { kind: 'moveColumn'; from: number; to: number; colName: string }
  | { kind: 'renameColumn'; colIndex: number; from: string; to: string }

/** 管线状态：行、每行来源、以及当前列名（列操作会改变列集合） */
export interface TableState {
  rows: CellValue[][]
  origins: number[]
  headers: string[]
}

export interface StepOutcome extends TableState {
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
): { steps: StepRecord[]; rows: CellValue[][]; origins: number[]; headers: string[] } {
  let state: TableState = {
    rows: baselineRows,
    origins: baselineRows.map((_, i) => i),
    headers: columns.map((c) => c.name),
  }
  const steps: StepRecord[] = []
  for (const spec of specs) {
    const out = applySpec(state, spec)
    steps.push({
      id: makeStepId(),
      at: Date.now(),
      spec,
      title: opTitle(spec),
      detail: out.detail,
      affected: out.affected,
    })
    state = { rows: out.rows, origins: out.origins, headers: out.headers }
  }
  return { steps, ...state }
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
    case 'fuzzyDedupe':
      return `模糊去重（${spec.colName}）`
    case 'filterRows':
      return `行筛选（${spec.colName} ${FILTER_LABEL[spec.op]} ${spec.value}）`
    case 'dropColumn':
      return `删除列（${spec.colName}）`
    case 'moveColumn':
      return `调整列顺序（${spec.colName}）`
    case 'renameColumn':
      return `重命名列（${spec.from} → ${spec.to}）`
  }
}

/** 在给定状态上执行一步，返回新状态（不修改入参） */
export function applySpec(state: TableState, spec: OpSpec): StepOutcome {
  const { rows, origins, headers } = state
  // 算子只需要列下标，给出最小结构即可，不要伪造完整的 Column
  const colRefs = headers.map((_, index) => ({ index }))

  switch (spec.kind) {
    case 'trim': {
      const r = opTrimWhitespace(rows, colRefs)
      return { rows: r.rows, origins, headers, affected: r.affected, detail: r.detail }
    }
    case 'fillMissing': {
      const r = opFillMissing(rows, spec.colIndex, spec.colName, spec.value)
      return { rows: r.rows, origins, headers, affected: r.affected, detail: r.detail }
    }
    case 'normalizeNumbers': {
      const r = opNormalizeNumbers(rows, spec.colIndex, spec.colName)
      return { rows: r.rows, origins, headers, affected: r.affected, detail: r.detail }
    }
    case 'dropDuplicates': {
      const r = opDropDuplicateRows(rows, colRefs)
      const kept = r.kept ?? rows.map((_, i) => i)
      return {
        rows: r.rows,
        origins: kept.map((i) => origins[i]),
        headers,
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
        headers,
        affected: r.affected,
        detail: r.detail,
      }
    }
    case 'fuzzyDedupe': {
      const drop = new Set(spec.dropRows)
      const keptRows: CellValue[][] = []
      const keptIdx: number[] = []
      for (let i = 0; i < rows.length; i++) {
        if (drop.has(i)) continue
        keptRows.push(rows[i])
        keptIdx.push(i)
      }
      const removed = rows.length - keptRows.length
      return {
        rows: keptRows,
        origins: keptIdx.map((i) => origins[i]),
        headers,
        affected: removed,
        detail: `「${spec.colName}」模糊去重删除 ${removed} 行（相似度阈值 ${spec.threshold.toFixed(2)}）`,
      }
    }
    case 'filterRows': {
      const r = opFilterRows(rows, spec.colIndex, spec.colName, spec.op, spec.value)
      const kept = r.kept ?? rows.map((_, i) => i)
      return {
        rows: r.rows,
        origins: kept.map((i) => origins[i]),
        headers,
        affected: r.affected,
        detail: r.detail,
      }
    }
    case 'dropColumn': {
      const r = opDropColumn(rows, headers, spec.colIndex)
      return { rows: r.rows, origins, headers: r.headers, affected: r.affected, detail: r.detail }
    }
    case 'moveColumn': {
      const r = opMoveColumn(rows, headers, spec.from, spec.to)
      return { rows: r.rows, origins, headers: r.headers, affected: r.affected, detail: r.detail }
    }
    case 'renameColumn': {
      const r = opRenameColumn(headers, spec.colIndex, spec.to)
      return { rows, origins, headers: r.headers, affected: 0, detail: r.detail }
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
  let state: TableState = {
    rows: baselineRows,
    origins: baselineRows.map((_, i) => i),
    headers: columns.map((c) => c.name),
  }
  for (const spec of specs) {
    const out = applySpec(state, spec)
    state = { rows: out.rows, origins: out.origins, headers: out.headers }
  }
  return { ...state, affected: 0, detail: '' }
}

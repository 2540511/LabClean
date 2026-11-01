import type { Column } from './types'
import { FILL_LABEL, resolveFillValue, type FillStrategy } from './clean'
import type { OpSpec } from './pipeline'

/**
 * 模板步骤：和真正的 OpSpec 的区别是「按列名引用、不存具体数值」。
 * 这样才能套用到列结构相同但数据不同的另一张表上。
 */
export type TemplateStep =
  | { kind: 'trim' }
  | { kind: 'dropDuplicates' }
  | { kind: 'dropEmptyRows' }
  | { kind: 'normalizeNumbers'; colName: string }
  | { kind: 'fillMissing'; colName: string; strategy: FillStrategy; custom?: string }

export interface CleanTemplate {
  id: string
  name: string
  createdAt: number
  builtin?: boolean
  steps: TemplateStep[]
}

const STORAGE_KEY = 'labclean.templates.v1'

export const BUILTIN_TEMPLATES: CleanTemplate[] = [
  {
    id: 'builtin-basic',
    name: '基础清理',
    createdAt: 0,
    builtin: true,
    steps: [{ kind: 'trim' }, { kind: 'dropEmptyRows' }, { kind: 'dropDuplicates' }],
  },
]

export function templateStepLabel(step: TemplateStep): string {
  switch (step.kind) {
    case 'trim':
      return '清理首尾空格'
    case 'dropEmptyRows':
      return '删除全空行'
    case 'dropDuplicates':
      return '删除重复行'
    case 'normalizeNumbers':
      return `转数字（${step.colName}）`
    case 'fillMissing':
      return `填充缺失（${step.colName} · ${FILL_LABEL[step.strategy]}）`
  }
}

export function findColumnByName(columns: Column[], name: string): Column | null {
  const exact = columns.find((c) => c.name === name)
  if (exact) return exact
  const loose = columns.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())
  return loose ?? null
}

/** 把已执行的步骤转成模板（列下标 → 列名） */
export function toTemplateSteps(specs: OpSpec[], columns: Column[]): TemplateStep[] {
  const out: TemplateStep[] = []
  for (const spec of specs) {
    switch (spec.kind) {
      case 'trim':
      case 'dropDuplicates':
      case 'dropEmptyRows':
        out.push({ kind: spec.kind })
        break
      case 'normalizeNumbers':
        out.push({ kind: 'normalizeNumbers', colName: columns[spec.colIndex]?.name ?? spec.colName })
        break
      case 'fillMissing':
        out.push({
          kind: 'fillMissing',
          colName: columns[spec.colIndex]?.name ?? spec.colName,
          strategy: spec.strategy,
          custom: spec.strategy === 'text' && typeof spec.value === 'string' ? spec.value : undefined,
        })
        break
      case 'fuzzyDedupe':
        // 模糊去重的待删行是「扫出来的」，换成另一张表就不成立了，所以不进模板
        break
    }
  }
  return out
}

/**
 * 把模板步骤落到某个具体数据源上。
 * 找不到对应列名的步骤会被跳过（不同表列结构不完全一致时也不至于报错）。
 */
export function materializeSteps(steps: TemplateStep[], columns: Column[]): OpSpec[] {
  const out: OpSpec[] = []
  for (const step of steps) {
    if (step.kind === 'trim' || step.kind === 'dropDuplicates' || step.kind === 'dropEmptyRows') {
      out.push({ kind: step.kind })
      continue
    }
    const col = findColumnByName(columns, step.colName)
    if (!col) continue
    if (step.kind === 'normalizeNumbers') {
      out.push({ kind: 'normalizeNumbers', colIndex: col.index, colName: col.name })
      continue
    }
    const value = resolveFillValue(col, step.strategy, step.custom)
    if (value === null) continue
    out.push({
      kind: 'fillMissing',
      colIndex: col.index,
      colName: col.name,
      strategy: step.strategy,
      value,
    })
  }
  return out
}

function isTemplate(v: unknown): v is CleanTemplate {
  if (!v || typeof v !== 'object') return false
  const t = v as CleanTemplate
  return typeof t.id === 'string' && typeof t.name === 'string' && Array.isArray(t.steps)
}

/** 只存规则，不存任何数据行 */
export function loadTemplates(): CleanTemplate[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isTemplate)
  } catch {
    return []
  }
}

export function persistTemplates(templates: CleanTemplate[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates.filter((t) => !t.builtin)))
  } catch {
    // 隐私模式下 localStorage 可能不可写，忽略即可
  }
}

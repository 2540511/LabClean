import type { Column } from './types'
import { FILL_LABEL, FILTER_LABEL, resolveFillValue, type FillStrategy, type FilterOp } from './clean'
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
  | { kind: 'filterRows'; colName: string; op: FilterOp; value: string }
  | { kind: 'dropColumn'; colName: string }
  /** 目标位置是列下标，套用到别的表时按「第几列」理解 */
  | { kind: 'moveColumn'; colName: string; to: number }
  | { kind: 'renameColumn'; colName: string; to: string }

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
    case 'filterRows':
      return `行筛选（${step.colName} ${FILTER_LABEL[step.op]} ${step.value}）`
    case 'dropColumn':
      return `删除列（${step.colName}）`
    case 'moveColumn':
      return `调整列顺序（${step.colName} → 第 ${step.to + 1} 列）`
    case 'renameColumn':
      return `重命名列（${step.colName} → ${step.to}）`
  }
}

export function findColumnByName(columns: Column[], name: string): Column | null {
  const exact = columns.find((c) => c.name === name)
  if (exact) return exact
  const loose = columns.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase())
  return loose ?? null
}

/** 把已执行的步骤转成模板；步骤里的列名对应执行时的布局 */
export function toTemplateSteps(specs: OpSpec[]): TemplateStep[] {
  const out: TemplateStep[] = []
  for (const spec of specs) {
    switch (spec.kind) {
      case 'trim':
      case 'dropDuplicates':
      case 'dropEmptyRows':
        out.push({ kind: spec.kind })
        break
      case 'normalizeNumbers':
        out.push({ kind: 'normalizeNumbers', colName: spec.colName })
        break
      case 'fillMissing':
        out.push({
          kind: 'fillMissing',
          colName: spec.colName,
          strategy: spec.strategy,
          custom: spec.strategy === 'text' && typeof spec.value === 'string' ? spec.value : undefined,
        })
        break
      case 'fuzzyDedupe':
        // 模糊去重的待删行是「扫出来的」，换成另一张表就不成立了，所以不进模板
        break
      case 'dropRows':
        // 手动点选删除的行号同样是「这张表」的，不进模板
        break
      case 'filterRows':
        out.push({
          kind: 'filterRows',
          colName: spec.colName,
          op: spec.op,
          value: spec.value,
        })
        break
      case 'dropColumn':
        out.push({ kind: 'dropColumn', colName: spec.colName })
        break
      case 'moveColumn':
        out.push({ kind: 'moveColumn', colName: spec.colName, to: spec.to })
        break
      case 'renameColumn':
        out.push({ kind: 'renameColumn', colName: spec.from, to: spec.to })
        break
    }
  }
  return out
}

/**
 * 把模板步骤落到某个具体数据源上。
 * 找不到对应列名的步骤会被跳过（不同表列结构不完全一致时也不至于报错）。
 *
 * 注意：这里必须用「演进中」的列布局来定位，不能拿原始的 columns 去查名字 ——
 * 模板里先重命名、再引用新名字是合法写法（如 改名「温度」→「温度(℃)」后筛选「温度(℃)」），
 * 而原始 columns 里永远没有新名字。
 */
export function materializeSteps(steps: TemplateStep[], columns: Column[]): OpSpec[] {
  const out: OpSpec[] = []
  // 当前布局：列名 + 它对应的原始列对象（取中位数等统计量要用，重命名后仍然指向同一列）
  const names = columns.map((c) => c.name)
  const sources = columns.slice()

  const indexOf = (name: string) => {
    const exact = names.indexOf(name)
    if (exact >= 0) return exact
    const lower = name.trim().toLowerCase()
    return names.findIndex((n) => n.trim().toLowerCase() === lower)
  }

  for (const step of steps) {
    if (step.kind === 'trim' || step.kind === 'dropDuplicates' || step.kind === 'dropEmptyRows') {
      out.push({ kind: step.kind })
      continue
    }

    const idx = indexOf(step.colName)
    if (idx < 0) continue
    const colName = names[idx]
    const source = sources[idx]

    if (step.kind === 'normalizeNumbers') {
      out.push({ kind: 'normalizeNumbers', colIndex: idx, colName })
      continue
    }
    if (step.kind === 'filterRows') {
      out.push({ kind: 'filterRows', colIndex: idx, colName, op: step.op, value: step.value })
      continue
    }
    if (step.kind === 'dropColumn') {
      out.push({ kind: 'dropColumn', colIndex: idx, colName })
      names.splice(idx, 1)
      sources.splice(idx, 1)
      continue
    }
    if (step.kind === 'moveColumn') {
      const to = Math.max(0, Math.min(names.length - 1, step.to))
      out.push({ kind: 'moveColumn', from: idx, to, colName })
      const [movedName] = names.splice(idx, 1)
      names.splice(to, 0, movedName)
      const [movedSource] = sources.splice(idx, 1)
      sources.splice(to, 0, movedSource)
      continue
    }
    if (step.kind === 'renameColumn') {
      out.push({ kind: 'renameColumn', colIndex: idx, from: colName, to: step.to })
      names[idx] = step.to
      continue
    }

    // 剩下的只有 fillMissing：填充值仍然按「原始列」的统计量算，保证跨表可复现
    const value = resolveFillValue(source, step.strategy, step.custom)
    if (value === null) continue
    out.push({
      kind: 'fillMissing',
      colIndex: idx,
      colName,
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

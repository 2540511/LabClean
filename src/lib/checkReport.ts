import type { Dataset } from '../core/types'
import type { StepRecord } from '../core/pipeline'

export interface CheckReportArgs {
  dataset: Dataset
  baseline: Dataset | null
  steps: StepRecord[]
  cursor: number
  now?: Date
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function stamp(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

function outliers(ds: Dataset): number {
  return ds.columns.reduce((a, c) => a + (c.numeric?.outliers ?? 0), 0)
}

/**
 * 生成一段可以直接粘进报告/作业里的简短校验说明。
 *
 * 只依赖体检结果和清洗步骤，不重新扫表，所以点开面板就能立刻看到。
 */
export function buildCheckReport(args: CheckReportArgs): string {
  const { dataset, baseline, steps, cursor } = args
  const applied = steps.slice(0, cursor)
  const base = baseline ?? dataset

  const removed = Math.max(0, base.meta.rowCount - dataset.meta.rowCount)
  const filled = applied
    .filter((s) => s.spec.kind === 'fillMissing')
    .reduce((a, s) => a + s.affected, 0)

  const outBefore = outliers(base)
  const outAfter = outliers(dataset)

  const lines: string[] = []
  lines.push('LabClean 清洗校验报告')
  lines.push(`生成时间：${stamp(args.now ?? new Date())}`)
  lines.push(`数据源：${base.name}${base.sheet ? ` · 工作表「${base.sheet}」` : ''}`)
  lines.push('———')
  lines.push(`原始行数：${base.meta.rowCount.toLocaleString()}`)
  lines.push(`清洗后行数：${dataset.meta.rowCount.toLocaleString()}`)
  lines.push(`删除行数：${removed.toLocaleString()}`)
  lines.push(`填充空值：${filled.toLocaleString()} 处`)
  lines.push(`空单元格：${base.meta.missingCells.toLocaleString()} → ${dataset.meta.missingCells.toLocaleString()}`)
  lines.push(`异常值：${outBefore.toLocaleString()} → ${outAfter.toLocaleString()}`)
  if (base.meta.score !== dataset.meta.score) {
    lines.push(`质量分：${base.meta.score} → ${dataset.meta.score}`)
  } else {
    lines.push(`质量分：${dataset.meta.score}`)
  }
  lines.push('———')
  if (applied.length === 0) {
    lines.push('清洗步骤：无（数据按原始状态）')
  } else {
    lines.push(`清洗步骤（已应用 ${applied.length} 步）：`)
    applied.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.title} — ${s.detail}`)
    })
    if (steps.length > cursor) {
      lines.push(`（另有 ${steps.length - cursor} 步已撤销，不计入）`)
    }
  }
  return lines.join('\n')
}

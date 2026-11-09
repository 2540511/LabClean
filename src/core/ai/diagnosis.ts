import type { Dataset } from '../types'

export type AiSeverity = 'high' | 'medium' | 'low'

export interface AiDiagnosisIssue {
  title: string
  severity: AiSeverity
  /** 涉及的列名，null 表示整体问题（如重复行） */
  column?: string | null
  evidence: string
  impact?: string
  suggestion: string
  howto?: string
}

export interface AiDiagnosis {
  overall?: string
  issues: AiDiagnosisIssue[]
  report: string
  /** 需要用户拍板的事 */
  questions?: string[]
}

export interface DiagnosisMessage {
  role: 'system' | 'user'
  content: string
}

export function normalizeChatEndpoint(endpoint: string): string {
  let url: URL
  try {
    url = new URL(endpoint.trim())
  } catch {
    throw new Error('接口地址不是有效 URL，请填写 http:// 或 https:// 开头的地址')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('接口地址只支持 HTTP 或 HTTPS')
  }
  const path = url.pathname.replace(/\/+$/, '')
  if (!path.endsWith('/chat/completions')) {
    url.pathname = path ? `${path}/chat/completions` : '/v1/chat/completions'
  } else {
    url.pathname = path
  }
  url.hash = ''
  return url.toString()
}

export function buildDiagnosisContext(dataset: Dataset): string {
  const profile = {
    table: {
      rowCount: dataset.meta.rowCount,
      columnCount: dataset.meta.colCount,
      missingCells: dataset.meta.missingCells,
      totalCells: dataset.meta.totalCells,
      duplicateRows: dataset.meta.duplicateRows,
      duplicateRowsChecked: dataset.meta.duplicateRowsChecked,
      qualityScore: dataset.meta.score,
      formulaOnly: dataset.meta.formulaOnly ?? 0,
      summaryRows: dataset.meta.summaryRows ?? 0,
      summarySheet: dataset.meta.summarySheet ?? false,
      notes: dataset.meta.notes,
    },
    columns: dataset.columns.map((column) => ({
      name: column.name,
      type: column.type,
      missing: column.missing,
      missingRate: column.missingRate,
      distinct: column.distinct,
      distinctApprox: column.distinctApprox,
      qualityScore: column.score,
      summary: column.summary ?? false,
      issues: column.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        count: issue.count,
        message: issue.message,
      })),
      numeric: column.numeric ?? null,
    })),
  }
  return JSON.stringify(profile, null, 2)
}

export function buildDiagnosisMessages(
  dataset: Dataset,
  systemPrompt: string,
): DiagnosisMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `请根据以下表格画像给出只读诊断意见。画像只有表头与统计摘要，没有数据行。\n${buildDiagnosisContext(dataset)}`,
    },
  ]
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`AI 返回缺少有效的 ${field} 字段`)
  }
  return value.trim()
}

function optionalString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function parseDiagnosisContent(content: string): AiDiagnosis {
  const trimmed = content
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('AI 返回的不是有效 JSON，请重试')
  }

  const body = record(parsed)
  if (!body || !Array.isArray(body.issues)) {
    throw new Error('AI 返回缺少 issues 数组')
  }

  const issues = body.issues.map((value): AiDiagnosisIssue => {
    const issue = record(value)
    if (!issue) throw new Error('AI 返回的 issues 中包含无效项目')
    const severity = requiredString(issue.severity, 'severity')
    if (severity !== 'high' && severity !== 'medium' && severity !== 'low') {
      throw new Error('AI 返回了无效的 severity，只接受 high、medium 或 low')
    }
    return {
      title: requiredString(issue.title, 'title'),
      severity,
      column: optionalString(issue.column) || null,
      evidence: requiredString(issue.evidence, 'evidence'),
      impact: optionalString(issue.impact),
      suggestion: requiredString(issue.suggestion, 'suggestion'),
      howto: optionalString(issue.howto),
    }
  })

  return {
    overall: optionalString(body.overall),
    issues,
    report: requiredString(body.report, 'report'),
    questions: Array.isArray(body.questions)
      ? body.questions.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      : [],
  }
}

export function parseAiResponse(payload: unknown): AiDiagnosis {
  const body = record(payload)
  const choice = Array.isArray(body?.choices) ? record(body.choices[0]) : null
  const message = record(choice?.message)
  if (typeof message?.content !== 'string') {
    throw new Error('AI 接口返回中没有可读取的诊断内容')
  }
  return parseDiagnosisContent(message.content)
}

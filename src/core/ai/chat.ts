import type { Dataset } from '../types'
import { buildDiagnosisContext } from './diagnosis'

export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiChatApiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export function buildAiChatMessages(
  dataset: Dataset,
  history: AiChatMessage[],
  systemPrompt: string,
): AiChatApiMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: `以下是当前表格画像，只有表头和统计摘要，没有数据行。后续问题都基于这份画像回答。\n${buildDiagnosisContext(dataset)}`,
    },
    ...history,
  ]
}

export function parseAiChatContent(content: unknown): string {
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 接口返回中没有可读取的聊天内容')
  }
  return content.trim()
}

export function parseAiChatResponse(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('AI 接口返回中没有可读取的聊天内容')
  }
  const choices = (payload as { choices?: unknown }).choices
  const choice = Array.isArray(choices) ? choices[0] : null
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) {
    throw new Error('AI 接口返回中没有可读取的聊天内容')
  }
  const message = (choice as { message?: unknown }).message
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    throw new Error('AI 接口返回中没有可读取的聊天内容')
  }
  return parseAiChatContent((message as { content?: unknown }).content)
}

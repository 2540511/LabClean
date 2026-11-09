import systemPrompt from './system-prompt.txt?raw'
import chatSystemPrompt from './chat-system-prompt.txt?raw'
import type { Dataset } from '../types'
import {
  buildAiChatMessages,
  parseAiChatResponse,
  type AiChatMessage,
} from './chat'
import {
  buildDiagnosisMessages,
  normalizeChatEndpoint,
  parseAiResponse,
  type AiDiagnosis,
} from './diagnosis'
import type { AiSettings } from './settings'
import { requestQoderChat, requestQoderDiagnosis } from './qoder-client'

function validatedApiSettings(settings: AiSettings): AiSettings {
  const endpoint = settings.endpoint.trim()
  const model = settings.model.trim()
  const apiKey = settings.apiKey.trim()
  if (!endpoint || !model || !apiKey) throw new Error('请完整填写接口地址、模型和 API Key')
  return {
    ...settings,
    enabled: true,
    provider: 'api',
    endpoint: normalizeChatEndpoint(endpoint),
    model,
    apiKey,
  }
}

async function responseError(response: Response, apiKey: string, action: string): Promise<Error> {
  let detail = ''
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const error = (body as { error?: unknown }).error
      if (error && typeof error === 'object' && !Array.isArray(error)) {
        const message = (error as { message?: unknown }).message
        if (typeof message === 'string') detail = message.slice(0, 300)
      }
    }
  } catch {
    // 非 JSON 错误页只保留 HTTP 状态
  }
  const safeDetail = detail.split(apiKey).join('[已隐藏]')
  return new Error(`${action}请求失败（HTTP ${response.status}）${safeDetail ? `：${safeDetail}` : ''}`)
}

function connectionError(cause: unknown, settings: AiSettings): Error {
  const reason = (cause instanceof Error ? cause.message : String(cause))
    .split(settings.apiKey)
    .join('[已隐藏]')
  const origin = new URL(settings.endpoint).origin
  return new Error(
    `无法连接模型服务（${reason || 'Failed to fetch'}）\n` +
      `请检查：1. 网络或代理能否访问 ${origin}；2. 接口地址是否正确；` +
      '3. 服务是否允许浏览器 / Tauri 跨域访问（CORS）。',
  )
}

async function requestPayload(
  config: AiSettings,
  body: Record<string, unknown>,
  action: string,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause
    throw connectionError(cause, config)
  }
  if (!response.ok) throw await responseError(response, config.apiKey, action)
  return response.json()
}

export async function requestAiDiagnosis(
  dataset: Dataset,
  settings: AiSettings,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AiDiagnosis> {
  if (!settings.enabled) throw new Error('AI 尚未启用，请先完成配置')
  if (settings.provider === 'qoder') return requestQoderDiagnosis(dataset, signal, fetchImpl)
  const config = validatedApiSettings(settings)
  const payload = await requestPayload(
    config,
    {
      model: config.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: buildDiagnosisMessages(dataset, systemPrompt),
    },
    '诊断',
    signal,
    fetchImpl,
  )
  return parseAiResponse(payload)
}

export async function requestAiChat(
  dataset: Dataset,
  history: AiChatMessage[],
  settings: AiSettings,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!settings.enabled) throw new Error('AI 尚未启用，请先完成配置')
  if (settings.provider === 'qoder') return requestQoderChat(dataset, history, signal, fetchImpl)
  const config = validatedApiSettings(settings)
  const payload = await requestPayload(
    config,
    {
      model: config.model,
      temperature: 0.3,
      messages: buildAiChatMessages(dataset, history, chatSystemPrompt),
    },
    '聊天',
    signal,
    fetchImpl,
  )
  return parseAiChatResponse(payload)
}

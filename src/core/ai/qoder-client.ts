import type { Dataset } from '../types'
import { parseAiChatContent, type AiChatMessage } from './chat'
import { buildDiagnosisContext, parseDiagnosisContent, type AiDiagnosis } from './diagnosis'

export interface QoderDiagnosisRequest {
  action: 'diagnosis'
  profile: string
}

export interface QoderChatRequest {
  action: 'chat'
  profile: string
  messages: AiChatMessage[]
}

export function buildQoderDiagnosisRequest(dataset: Dataset): QoderDiagnosisRequest {
  return { action: 'diagnosis', profile: buildDiagnosisContext(dataset) }
}

export function buildQoderChatRequest(dataset: Dataset, history: AiChatMessage[]): QoderChatRequest {
  return { action: 'chat', profile: buildDiagnosisContext(dataset), messages: history }
}

function errorMessage(status: number, code: string): string {
  if (status === 401 || code === 'login_required') return '请先登录 Qoder 账号后重试'
  if (status === 403) return '当前 Qoder 账号没有使用此站点 AI 的权限'
  if (status === 429) return 'Qoder AI 调用过于频繁或额度不足，请稍后再试'
  if (code === 'qoder_service_not_ready' || code === 'ai_not_configured') {
    return 'Qoder 云端服务尚未启用，请由站点所有者完成配置'
  }
  return `Qoder 请求失败（HTTP ${status}），请稍后重试`
}

async function responseError(response: Response): Promise<Error> {
  let code = ''
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const error = (body as { error?: unknown }).error
      if (error && typeof error === 'object' && !Array.isArray(error)) {
        const value = (error as { code?: unknown }).code
        if (typeof value === 'string') code = value
      }
    }
  } catch {
    // 网关非 JSON 响应只使用 HTTP 状态
  }
  return new Error(errorMessage(response.status, code))
}

async function requestQoderContent(
  body: QoderDiagnosisRequest | QoderChatRequest,
  signal: AbortSignal | undefined,
  fetchImpl: typeof fetch,
): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl('/functions/v1/app', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      referrerPolicy: 'no-referrer',
      body: JSON.stringify(body),
      signal,
    })
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause
    throw new Error('无法连接 Qoder 站点服务，请确认当前页面已部署到 Qoder Sites，或稍后再试')
  }
  if (!response.ok) throw await responseError(response)
  const payload: unknown = await response.json()
  const content =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as { content?: unknown }).content
      : null
  return parseAiChatContent(content)
}

export async function requestQoderDiagnosis(
  dataset: Dataset,
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<AiDiagnosis> {
  const content = await requestQoderContent(buildQoderDiagnosisRequest(dataset), signal, fetchImpl)
  return parseDiagnosisContent(content)
}

export async function requestQoderChat(
  dataset: Dataset,
  history: AiChatMessage[],
  signal?: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  return requestQoderContent(buildQoderChatRequest(dataset, history), signal, fetchImpl)
}

export function startQoderLogin(): void {
  const returnPath = `${window.location.pathname}${window.location.search}${window.location.hash}`
  window.location.assign(`/__qoder_auth/start?return_path=${encodeURIComponent(returnPath)}`)
}

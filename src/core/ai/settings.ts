export type AiProvider = 'api' | 'qoder'

export interface AiSettings {
  enabled: boolean
  provider: AiProvider
  endpoint: string
  model: string
  apiKey: string
}

const STORAGE_KEY = 'labclean.ai-settings.v1'

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  provider: 'api',
  endpoint: 'https://api.openai.com/v1/chat/completions',
  model: 'gpt-4o-mini',
  apiKey: '',
}

export function loadAiSettings(): AiSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_AI_SETTINGS }
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ...DEFAULT_AI_SETTINGS }
    }
    const saved = value as Partial<AiSettings>
    return {
      enabled: saved.enabled === true,
      provider: saved.provider === 'qoder' ? 'qoder' : 'api',
      endpoint:
        typeof saved.endpoint === 'string' && saved.endpoint.trim()
          ? saved.endpoint
          : DEFAULT_AI_SETTINGS.endpoint,
      model:
        typeof saved.model === 'string' && saved.model.trim()
          ? saved.model
          : DEFAULT_AI_SETTINGS.model,
      apiKey: typeof saved.apiKey === 'string' ? saved.apiKey : '',
    }
  } catch {
    return { ...DEFAULT_AI_SETTINGS }
  }
}

export function selectAiProvider(settings: AiSettings, provider: AiProvider): AiSettings {
  return { ...settings, provider }
}

export function isAiSettingsComplete(settings: AiSettings): boolean {
  if (!settings.enabled) return false
  if (settings.provider === 'qoder') return true
  return Boolean(settings.endpoint.trim() && settings.model.trim() && settings.apiKey.trim())
}

export function persistAiSettings(settings: AiSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // 隐私模式下仅保留当前会话设置
  }
}

export function clearAiSettings(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 隐私模式下无需额外处理
  }
}

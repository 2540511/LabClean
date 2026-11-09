import { useEffect, useRef, useState } from 'react'
import { requestAiDiagnosis } from '../core/ai/client'
import type { AiDiagnosis, AiSeverity } from '../core/ai/diagnosis'
import {
  clearAiSettings,
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  persistAiSettings,
  type AiSettings,
} from '../core/ai/settings'
import type { Dataset } from '../core/types'

const SEVERITY_LABEL: Record<AiSeverity, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

const AI_ENDPOINT_PRESETS = [
  { name: '小米 MiMo', endpoint: 'https://api.xiaomimimo.com/v1' },
  { name: 'OpenAI', endpoint: 'https://api.openai.com/v1' },
  { name: 'DeepSeek', endpoint: 'https://api.deepseek.com/chat/completions' },
  { name: 'Kimi（月之暗面）', endpoint: 'https://api.moonshot.cn/v1' },
  { name: '智谱 GLM', endpoint: 'https://open.bigmodel.cn/api/paas/v4' },
  { name: '阿里云百炼', endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1' },
  { name: '火山方舟', endpoint: 'https://ark.cn-beijing.volces.com/api/v3' },
  { name: '硅基流动', endpoint: 'https://api.siliconflow.cn/v1' },
]

interface Props {
  open: boolean
  dataset: Dataset | null
  onClose: () => void
  onSelectColumn?: (name: string) => void
}

export function AiDiagnosisDialog({ open, dataset, onClose, onSelectColumn }: Props) {
  const [settings, setSettings] = useState<AiSettings>(loadAiSettings)
  const [consented, setConsented] = useState(settings.enabled)
  const [result, setResult] = useState<AiDiagnosis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedEndpoint, setCopiedEndpoint] = useState<string | null>(null)
  const requestRef = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!open) requestRef.current?.abort()
  }, [open])

  useEffect(() => {
    requestRef.current?.abort()
    setResult(null)
    setError(null)
    setCopied(false)
  }, [dataset?.id])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => () => requestRef.current?.abort(), [])

  if (!open || !dataset) return null

  const diagnose = async () => {
    const config = {
      ...settings,
      enabled: true,
      endpoint: settings.endpoint.trim(),
      model: settings.model.trim(),
      apiKey: settings.apiKey.trim(),
    }
    persistAiSettings(config)
    setSettings(config)
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    setLoading(true)
    setError(null)
    setCopied(false)
    try {
      const diagnosis = await requestAiDiagnosis(dataset, config, controller.signal)
      if (!controller.signal.aborted) setResult(diagnosis)
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (requestRef.current === controller) {
        setLoading(false)
        requestRef.current = null
      }
    }
  }

  const copyReport = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.report)
      setCopied(true)
    } catch {
      setError('复制失败，请选中报告文字后手动复制')
    }
  }

  const copyEndpoint = async (endpoint: string) => {
    try {
      await navigator.clipboard.writeText(endpoint)
      setCopiedEndpoint(endpoint)
      setError(null)
    } catch {
      setError('复制失败，请手动选中接口地址复制')
    }
  }

  const canDiagnose = Boolean(
    settings.enabled && settings.endpoint.trim() && settings.model.trim() && settings.apiKey.trim(),
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal-wide"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="AI 数据诊断"
      >
        <div className="modal-head">
          <strong>AI 数据诊断</strong>
          <button className="modal-x" onClick={onClose} title="关闭 (Esc)">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="ai-privacy">
            <strong>只发送表结构，不发送数据行</strong>
            <p>
              发送内容包括表头、字段类型、缺失/重复/异常统计和数值摘要；不发送数据行、单元格样本或高频值。
              AI 默认关闭，启用后也仅在你点击「开始诊断」时联网。
            </p>
          </div>

          <div className="ai-endpoint-presets">
            <div className="ai-endpoint-title">
              <strong>常见 OpenAI 兼容接口地址</strong>
              <span>点击复制，粘贴到下方接口地址</span>
            </div>
            <div className="ai-endpoint-list">
              {AI_ENDPOINT_PRESETS.map((preset) => (
                <div className="ai-endpoint-row" key={preset.name}>
                  <span className="ai-endpoint-name">{preset.name}</span>
                  <code>{preset.endpoint}</code>
                  <button
                    type="button"
                    className="btn btn-small"
                    onClick={() => void copyEndpoint(preset.endpoint)}
                  >
                    {copiedEndpoint === preset.endpoint ? '已复制' : '复制'}
                  </button>
                </div>
              ))}
            </div>
            <p>以上为通用/按量计费地址；Coding、Token Plan 等套餐请使用平台提供的专属地址。</p>
          </div>

          {!settings.enabled ? (
            <div className="ai-consent">
              <label>
                <input
                  type="checkbox"
                  checked={consented}
                  onChange={(event) => setConsented(event.target.checked)}
                />
                我已了解：诊断会把上述表结构和统计摘要发送给我配置的模型服务
              </label>
              <button
                className="btn btn-primary"
                disabled={!consented}
                onClick={() => setSettings((prev) => ({ ...prev, enabled: true }))}
              >
                了解，配置 AI
              </button>
            </div>
          ) : (
            <>
              <div className="ai-settings">
                <label className="ai-field ai-field-wide">
                  <span>OpenAI 兼容接口地址或 API 根地址</span>
                  <input
                    className="input"
                    type="url"
                    value={settings.endpoint}
                    onChange={(event) => setSettings({ ...settings, endpoint: event.target.value })}
                    disabled={loading}
                    spellCheck={false}
                    placeholder="https://你的服务/v1 或完整的 /chat/completions 地址"
                  />
                  <small>
                    只填到 /v1 会自动补全；Failed to fetch 通常表示网络不可达、代理未配置或服务不允许跨域。
                  </small>
                </label>
                <label className="ai-field">
                  <span>模型</span>
                  <input
                    className="input"
                    value={settings.model}
                    onChange={(event) => setSettings({ ...settings, model: event.target.value })}
                    disabled={loading}
                    spellCheck={false}
                  />
                </label>
                <label className="ai-field">
                  <span>API Key</span>
                  <input
                    className="input"
                    type="password"
                    value={settings.apiKey}
                    onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })}
                    disabled={loading}
                    autoComplete="new-password"
                    placeholder="仅保存在当前浏览器的 localStorage"
                  />
                </label>
              </div>

              <div className="ai-actions">
                <button
                  className="btn btn-primary"
                  disabled={!canDiagnose || loading}
                  onClick={() => void diagnose()}
                >
                  {loading ? '诊断中…' : result ? '重新诊断' : '开始诊断'}
                </button>
                <span>开始诊断时保存配置；API Key 不会写入项目文件。</span>
                <button
                  className="btn btn-small ai-disable"
                  disabled={loading}
                  onClick={() => {
                    clearAiSettings()
                    setSettings({ ...DEFAULT_AI_SETTINGS })
                    setConsented(false)
                    setResult(null)
                    setError(null)
                  }}
                >
                  停用并清除 Key
                </button>
              </div>
            </>
          )}

          {error ? (
            <div className="ai-error" role="alert">
              {error}
            </div>
          ) : null}

          {result ? (
            <div className="ai-results">
              {result.overall ? <p className="ai-overall">{result.overall}</p> : null}

              <section>
                <h3>质量问题与处理建议</h3>
                {result.issues.length === 0 ? (
                  <div className="log-empty">模型没有发现明确的质量问题，请结合统计摘要人工复核。</div>
                ) : (
                  <div className="ai-issue-list">
                    {result.issues.map((issue, index) => (
                      <article className="ai-issue" key={`${issue.title}-${index}`}>
                        <div className="ai-issue-head">
                          <strong>{issue.title}</strong>
                          <span className={`ai-severity ai-severity-${issue.severity}`}>
                            {SEVERITY_LABEL[issue.severity]}优先级
                          </span>
                        </div>
                        <p>
                          <b>依据：</b>
                          {issue.evidence}
                        </p>
                        {issue.impact ? (
                          <p className="ai-impact">
                            <b>影响：</b>
                            {issue.impact}
                          </p>
                        ) : null}
                        <p>
                          <b>建议：</b>
                          {issue.suggestion}
                        </p>
                        {issue.howto ? (
                          <div className="ai-howto">
                            <span>{issue.howto}</span>
                            {issue.column && onSelectColumn ? (
                              <button
                                type="button"
                                className="btn btn-small"
                                onClick={() => onSelectColumn(issue.column!)}
                                title={`定位到列：${issue.column}`}
                              >
                                跳到这一列
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    ))}
                  </div>
                )}
              </section>

              {result.questions && result.questions.length > 0 ? (
                <section className="ai-questions">
                  <h3>需要你确认</h3>
                  <ul>
                    {result.questions.map((question, index) => (
                      <li key={`${question}-${index}`}>{question}</li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section className="ai-report">
                <div className="ai-report-head">
                  <h3>实验报告文字</h3>
                  <button className="btn btn-small" onClick={() => void copyReport()}>
                    {copied ? '已复制' : '复制报告'}
                  </button>
                </div>
                <p>{result.report}</p>
              </section>

              <p className="ai-readonly">以上意见仅供人工参考，不会修改数据、清洗步骤或撤销历史。</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

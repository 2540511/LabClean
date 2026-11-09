import { useEffect, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AiChatMessage } from '../core/ai/chat'
import { requestAiChat } from '../core/ai/client'
import { isAiSettingsComplete, persistAiSettings, type AiSettings } from '../core/ai/settings'
import type { Dataset } from '../core/types'

interface Props {
  dataset: Dataset
  active: boolean
  settings: AiSettings
  onSettingsChange: Dispatch<SetStateAction<AiSettings>>
  onOpenSettings: () => void
}

export function AiChatPanel({
  dataset,
  active,
  settings,
  onSettingsChange,
  onOpenSettings,
}: Props) {
  const [messages, setMessages] = useState<AiChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    requestRef.current?.abort()
    setMessages([])
    setInput('')
    setError(null)
    setLoading(false)
  }, [dataset.id])

  useEffect(() => () => requestRef.current?.abort(), [])

  useEffect(() => {
    if (!active || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [active, messages, loading])

  const configured = isAiSettingsComplete(settings)
  const canSend = configured && Boolean(input.trim()) && !loading

  const send = async () => {
    const text = input.trim()
    if (!text || !configured || loading) return
    const config = {
      ...settings,
      enabled: true,
      endpoint: settings.endpoint.trim(),
      model: settings.model.trim(),
      apiKey: settings.apiKey.trim(),
    }
    const nextMessages: AiChatMessage[] = [...messages, { role: 'user', content: text }]
    persistAiSettings(config)
    onSettingsChange(config)
    setMessages(nextMessages)
    setInput('')
    setError(null)
    setLoading(true)
    requestRef.current?.abort()
    const controller = new AbortController()
    requestRef.current = controller
    try {
      const answer = await requestAiChat(dataset, nextMessages, config, controller.signal)
      if (!controller.signal.aborted) {
        setMessages([...nextMessages, { role: 'assistant', content: answer }])
      }
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

  return (
    <section
      className="ai-chat"
      hidden={!active}
      id="inspector-chat-panel"
      role="tabpanel"
      aria-labelledby="inspector-chat-tab"
    >
      <div className="ai-chat-privacy">
        <strong>只发送表结构、统计摘要和聊天内容</strong>
        <span>不自动发送数据行；请勿在聊天中粘贴敏感数据。</span>
        <button type="button" className="link-btn" onClick={onOpenSettings}>
          AI 设置 · {settings.provider === 'qoder' ? 'Qoder 账号' : '自定义 API'}
        </button>
      </div>

      {!configured ? (
        <div className="ai-chat-setup">
          <span>
            {!settings.enabled
              ? 'AI 默认关闭，请先在 AI 诊断中同意隐私说明并选择 AI 来源。'
              : settings.provider === 'qoder'
                ? 'Qoder 账号模式已选择，无需填写 API Key。'
                : '请完整填写接口地址、模型和 API Key。'}
          </span>
          <button type="button" className="btn btn-small" onClick={onOpenSettings}>
            配置 AI
          </button>
        </div>
      ) : null}

      <div className="ai-chat-messages" ref={scrollRef} aria-live="polite">
        {messages.length === 0 ? (
          <div className="ai-chat-empty">
            <strong>问问这份数据</strong>
            <p>例如：温度列的缺失值应该怎么处理？这些异常值可能有什么影响？</p>
          </div>
        ) : (
          messages.map((message, index) => (
            <div className={`ai-chat-message ai-chat-${message.role}`} key={index}>
              <span>{message.role === 'user' ? '你' : 'AI'}</span>
              <p>{message.content}</p>
            </div>
          ))
        )}
        {loading ? (
          <div className="ai-chat-message ai-chat-assistant">
            <span>AI</span>
            <p>正在思考…</p>
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="ai-error ai-chat-error" role="alert">
          {error}
        </div>
      ) : null}

      <form
        className="ai-chat-composer"
        onSubmit={(event) => {
          event.preventDefault()
          if (canSend) void send()
        }}
      >
        <textarea
          className="input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (canSend) void send()
            }
          }}
          placeholder="输入关于这份数据的问题…"
          aria-label="聊天内容"
          rows={3}
          disabled={loading}
        />
        <div className="ai-chat-composer-foot">
          <span>Enter 发送 · Shift+Enter 换行</span>
          <button className="btn btn-primary" type="submit" disabled={!canSend}>
            {loading ? '等待回复…' : '发送'}
          </button>
        </div>
      </form>
    </section>
  )
}

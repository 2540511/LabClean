import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

/**
 * 兜底诊断：宁可把错误大字打在页面上，也不要留给用户一片白屏。
 * 桌面版（Tauri）看不到控制台，这层是唯一的线索来源。
 */
function showFatal(title: string, detail: string): void {
  const host = document.getElementById('root') ?? document.body
  const box = document.createElement('div')
  box.setAttribute('data-fatal', '1')
  box.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:99999',
    'padding:28px',
    'background:#fff',
    'color:#b91c1c',
    'font:13px/1.6 ui-monospace,Consolas,monospace',
    'overflow:auto',
    'white-space:pre-wrap',
  ].join(';')
  box.textContent = [
    `【LabClean 启动失败】${title}`,
    '',
    detail,
    '',
    `页面地址: ${location.href}`,
    `浏览器: ${navigator.userAgent}`,
  ].join('\n')
  host.appendChild(box)
}

window.addEventListener('error', (e) => {
  const err = e.error as Error | undefined
  showFatal(err?.message ?? e.message ?? '未知错误', String(err?.stack ?? ''))
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason as Error | undefined
  showFatal(reason?.message ?? String(e.reason), String(reason?.stack ?? ''))
})

const root = document.getElementById('root')
if (!root) {
  showFatal('找不到挂载节点 #root', 'index.html 可能没有正确加载')
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )

  // React 挂载完成后如果页面还是空的，说明脚本根本没跑起来
  window.setTimeout(() => {
    if (root.childElementCount === 0) {
      const scripts = Array.from(document.scripts)
        .map((s) => s.src)
        .filter(Boolean)
      const styles = Array.from(document.querySelectorAll('link[rel=stylesheet]')).map(
        (l) => (l as HTMLLinkElement).href,
      )
      showFatal(
        '界面没有渲染出来',
        [
          '脚本可能没有加载成功（资源 404 或被拦截）。',
          `已加载的脚本: ${scripts.join(' , ') || '（无）'}`,
          `已加载的样式: ${styles.join(' , ') || '（无）'}`,
        ].join('\n'),
      )
    }
  }, 4000)
}

interface Props {
  onPick: () => void
  onDemo: () => void
}

const FEATURES = [
  ['自动体检', '类型识别、缺失、重复、异常值，一次算清'],
  ['稳健判据', '中位数 + MAD 判定异常，不被极端值带偏'],
  ['前后可查', '每一步清洗都记在操作记录里，可复现'],
  ['结果可交', '一个 xlsx 含数据、体检报告、摘要和日志'],
]

export function EmptyState({ onPick, onDemo }: Props) {
  return (
    <div className="empty-wrap">
      <div className="empty-card">
        <div className="empty-icon" aria-hidden>
          <svg viewBox="0 0 48 48" width="44" height="44">
            <rect x="6" y="8" width="36" height="32" rx="5" fill="none" stroke="currentColor" strokeWidth="2.2" />
            <path d="M6 18h36M18 18v22" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            <path d="M24 38v-8m6 8v-13m6 13v-5" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
          </svg>
        </div>
        <h1>把 Excel / CSV 拖进来</h1>
        <p className="empty-sub">
          支持 .xlsx / .xls / .csv，多个工作表会自动识别；文件越大越能体现差别。
        </p>
        <div className="empty-actions">
          <button className="btn btn-primary btn-lg" onClick={onPick}>
            选择文件
          </button>
          <button className="btn btn-lg" onClick={onDemo}>
            载入示例数据
          </button>
        </div>
        <div className="empty-privacy">
          <span className="lock-dot" />
          数据不会离开这台电脑，全程在本机浏览器里处理
        </div>

        <div className="empty-features">
          {FEATURES.map(([title, desc]) => (
            <div key={title} className="feature">
              <strong>{title}</strong>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

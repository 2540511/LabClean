import { useEffect, useState } from 'react'
import type { CleanTemplate } from '../core/template'
import { templateStepLabel } from '../core/template'

export type ApplyScope = 'active' | 'all'

interface Props {
  open: boolean
  templates: CleanTemplate[]
  /** 当前数据源已应用的步数 */
  stepCount: number
  sourceCount: number
  onClose: () => void
  onSave: (name: string) => void
  onApply: (id: string, scope: ApplyScope) => void
  onDelete: (id: string) => void
}

export function TemplateDialog({
  open,
  templates,
  stepCount,
  sourceCount,
  onClose,
  onSave,
  onApply,
  onDelete,
}: Props) {
  const [name, setName] = useState('')

  useEffect(() => {
    if (open) setName('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="清洗模板">
        <div className="modal-head">
          <strong>清洗模板</strong>
          <button className="modal-x" onClick={onClose} title="关闭 (Esc)">
            ×
          </button>
        </div>

        <div className="modal-body">
          <div className="tpl-save">
            <input
              className="input"
              placeholder={stepCount > 0 ? `给这 ${stepCount} 步起个名字` : '先做几步清洗再保存'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={stepCount === 0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim() && stepCount > 0) {
                  onSave(name.trim())
                  setName('')
                }
              }}
            />
            <button
              className="btn btn-primary"
              disabled={stepCount === 0 || name.trim().length === 0}
              onClick={() => {
                onSave(name.trim())
                setName('')
              }}
            >
              存为模板
            </button>
          </div>
          <p className="tpl-hint">
            模板只记录「怎么清洗」（按列名引用），不包含任何数据；套用时会替换该数据源现有的清洗步骤。
            模糊去重依赖具体数据，不会被存进模板。
          </p>

          <div className="tpl-list">
            {templates.map((t) => (
              <div className="tpl-item" key={t.id}>
                <div className="tpl-main">
                  <div className="tpl-name">
                    {t.name}
                    {t.builtin ? <span className="tpl-tag">内置</span> : null}
                  </div>
                  <div className="tpl-steps">{t.steps.map(templateStepLabel).join(' → ')}</div>
                </div>
                <div className="tpl-actions">
                  <button className="btn btn-small" onClick={() => onApply(t.id, 'active')}>
                    应用到当前
                  </button>
                  <button
                    className="btn btn-small"
                    disabled={sourceCount < 2}
                    onClick={() => onApply(t.id, 'all')}
                    title={sourceCount < 2 ? '只有一个数据源' : `应用到全部 ${sourceCount} 个数据源`}
                  >
                    应用到全部
                  </button>
                  {t.builtin ? null : (
                    <button className="btn btn-small tpl-del" onClick={() => onDelete(t.id)}>
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
            {templates.length === 0 ? <div className="log-empty">还没有模板</div> : null}
          </div>
        </div>
      </div>
    </div>
  )
}

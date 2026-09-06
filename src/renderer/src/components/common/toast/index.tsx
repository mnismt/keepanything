import * as stylex from '@stylexjs/stylex'
import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type Toast as ToastModel, useToasts } from '../../../state/toasts'
import { shared } from '../../../styles/shared'
import { styles } from './styles'

function ToastItem({ toast }: { toast: ToastModel }): React.JSX.Element {
  const dismiss = useToasts((s) => s.dismiss)
  const [hover, setHover] = useState(false)
  const remaining = useRef(toast.ttl)
  const started = useRef(Date.now())

  useEffect(() => {
    if (hover) {
      remaining.current -= Date.now() - started.current
      return
    }
    started.current = Date.now()
    const t = setTimeout(() => dismiss(toast.id), Math.max(400, remaining.current))
    return () => clearTimeout(t)
  }, [hover, toast.id, dismiss])

  return (
    <div
      {...stylex.props(styles.toast)}
      role="status"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span {...stylex.props(styles.text)}>
        {toast.text}
        {toast.detail ? <span {...stylex.props(styles.detail)}>{toast.detail}</span> : null}
      </span>
      {toast.secondary ? (
        <button
          type="button"
          {...stylex.props(shared.hoverFade, styles.action, styles.secondary)}
          onClick={() => {
            void toast.secondary?.run()
            dismiss(toast.id)
          }}
        >
          {toast.secondary.label}
        </button>
      ) : null}
      {toast.action ? (
        <button
          type="button"
          {...stylex.props(shared.hoverFade, styles.action)}
          onClick={() => {
            void toast.action?.run()
            dismiss(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        {...stylex.props(shared.hoverFade, styles.close)}
        aria-label="Dismiss"
        onClick={() => dismiss(toast.id)}
      >
        <X size={14} strokeWidth={1.5} />
      </button>
    </div>
  )
}

/** Toast entries (max 3). The StatusStack owns the fixed bottom-right container. */
export function ToastStack(): React.JSX.Element | null {
  const toasts = useToasts((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <>
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </>
  )
}

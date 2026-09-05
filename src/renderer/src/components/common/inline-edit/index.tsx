import type { StyleXStyles } from '@stylexjs/stylex'
import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef, useState } from 'react'
import { styles } from './styles'

export interface InlineEditProps {
  value: string
  /** Called with the trimmed value when it changed. */
  onSave: (next: string) => void | Promise<void>
  placeholder?: string
  /** Multi-line editing (textarea, ⌘↩ saves). */
  multiline?: boolean
  /** Text styles applied to both the static text and the field. */
  style?: StyleXStyles
  /** Accessible name of the field. */
  label: string
  disabled?: boolean
}

/**
 * Click-to-edit text. Enter (or ⌘↩ when multiline) saves, Esc cancels, blur saves. Renders as a
 * button at rest so it is reachable by keyboard.
 */
export function InlineEdit({
  value,
  onSave,
  placeholder = 'Add…',
  multiline = false,
  style,
  label,
  disabled = false
}: InlineEditProps): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement & HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  useEffect(() => {
    if (!editing) return
    const el = ref.current
    if (!el) return
    el.focus()
    el.select()
    if (multiline) el.style.height = `${el.scrollHeight}px`
  }, [editing, multiline])

  const commit = (): void => {
    setEditing(false)
    const next = draft.trim()
    if (next !== value.trim()) void onSave(next)
  }
  const cancel = (): void => {
    setDraft(value)
    setEditing(false)
  }

  if (!editing) {
    return (
      <button
        type="button"
        {...stylex.props(styles.text, style, !value && styles.placeholder)}
        onClick={() => !disabled && setEditing(true)}
        aria-label={`Edit ${label}`}
        disabled={disabled}
      >
        {value || placeholder}
      </button>
    )
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancel()
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      commit()
    }
  }

  if (multiline) {
    return (
      <textarea
        ref={ref}
        {...stylex.props(styles.field, style)}
        value={draft}
        rows={3}
        aria-label={label}
        onChange={(e) => {
          setDraft(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${e.target.scrollHeight}px`
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
    )
  }
  return (
    <input
      ref={ref}
      {...stylex.props(styles.field, style)}
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  )
}

import * as stylex from '@stylexjs/stylex'
import { Ellipsis } from 'lucide-react'
import type { MouseEvent } from 'react'
import { styles } from './styles'

/** The hover "..." that opens a native context menu at the click position. */
export function MenuTrigger({
  onOpen,
  label = 'More'
}: {
  onOpen: (e: MouseEvent) => void
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      {...stylex.props(styles.trigger)}
      aria-label={label}
      aria-haspopup="menu"
      onClick={(e) => {
        e.stopPropagation()
        onOpen(e)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <Ellipsis size={16} strokeWidth={1.5} />
    </button>
  )
}

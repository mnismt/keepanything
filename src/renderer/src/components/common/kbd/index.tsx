import type { StyleXStyles } from '@stylexjs/stylex'
import * as stylex from '@stylexjs/stylex'
import { styles } from './styles'

/** Keyboard hint, e.g. `<Kbd>⌘K</Kbd>`. Decorative; hidden from the accessibility tree. */
export function Kbd({ children, style }: { children: string; style?: StyleXStyles }): React.JSX.Element {
  return (
    <kbd {...stylex.props(styles.kbd, style)} aria-hidden="true">
      {children}
    </kbd>
  )
}

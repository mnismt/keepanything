import * as stylex from '@stylexjs/stylex'
import { styles } from './styles'

/** Keyboard hint, e.g. `<Kbd>⌘K</Kbd>`. Decorative; hidden from the accessibility tree. */
export function Kbd({ children }: { children: string }): React.JSX.Element {
  return (
    <kbd {...stylex.props(styles.kbd)} aria-hidden="true">
      {children}
    </kbd>
  )
}

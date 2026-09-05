import * as stylex from '@stylexjs/stylex'
import { COPY } from '../../../../../shared/constants'
import { useUi } from '../../../state/ui'
import { styles } from './styles'

/**
 * Full-window drop target visual. Drag events are handled at the App root (`useWindowCapture`),
 * so this component only renders while an external drag hovers the window.
 */
export function DropOverlay(): React.JSX.Element | null {
  const dragOver = useUi((s) => s.dragOver)
  const collectionId = useUi((s) => s.collectionId)
  const section = useUi((s) => s.section)
  if (!dragOver) return null
  const inCollection = section === 'collection' && collectionId
  return (
    <div {...stylex.props(styles.overlay)} aria-hidden="true">
      <div {...stylex.props(styles.ring)} />
      <div {...stylex.props(styles.hint)}>
        <div {...stylex.props(styles.hintTitle)}>{COPY.dropHint}</div>
        <div {...stylex.props(styles.hintSub)}>{inCollection ? 'Keep it here' : COPY.dropSub}</div>
      </div>
    </div>
  )
}

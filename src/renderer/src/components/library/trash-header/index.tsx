import * as stylex from '@stylexjs/stylex'
import { useLibrary } from '../../../state/library'
import { useToasts } from '../../../state/toasts'
import { Button } from '../../common'
import { styles } from './styles'

/** Restore / Delete forever for the selection, Empty Trash for everything. */
export function TrashHeader(): React.JSX.Element | null {
  const selection = useLibrary((s) => s.selection)
  const order = useLibrary((s) => s.order)
  const restore = useLibrary((s) => s.restore)
  const deleteForever = useLibrary((s) => s.deleteForever)
  const push = useToasts((s) => s.push)
  if (order.length === 0) return null
  const ids = [...selection]
  return (
    <div {...stylex.props(styles.bar)}>
      <span>Items in the Trash stay until you delete them.</span>
      <span {...stylex.props(styles.spacer)} />
      <Button small variant="quiet" disabled={ids.length === 0} onClick={() => void restore(ids)}>
        Restore
      </Button>
      <Button small variant="danger" disabled={ids.length === 0} onClick={() => void deleteForever(ids)}>
        Delete forever
      </Button>
      <Button
        small
        variant="danger"
        onClick={async () => {
          const ok = await deleteForever(order)
          if (ok) push({ text: 'Trash emptied.' })
        }}
      >
        Empty Trash
      </Button>
    </div>
  )
}

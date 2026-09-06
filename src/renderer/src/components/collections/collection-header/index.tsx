import * as stylex from '@stylexjs/stylex'
import { Pencil, Trash2 } from 'lucide-react'
import { useCollections } from '../../../state/collections'
import { useUi } from '../../../state/ui'
import { InlineEdit } from '../../common'
import { styles } from './styles'

/** Header inside a collection view: the agent's reason ("Because these all...") or an inline editable description. */
export function CollectionHeader({ collectionId }: { collectionId: string }): React.JSX.Element | null {
  const c = useCollections((s) => s.list.find((x) => x.id === collectionId))
  const rename = useCollections((s) => s.rename)
  const pushModal = useUi((s) => s.push)
  if (!c) return null
  const agentMade = c.createdBy === 'agent'
  return (
    <div {...stylex.props(styles.header)}>
      {agentMade && c.description ? (
        <p {...stylex.props(styles.reason, styles.reasonGrow)}>
          <span {...stylex.props(styles.reasonLead)}>Why these belong together · </span>
          {c.description}
        </p>
      ) : (
        <InlineEdit
          value={c.description ?? ''}
          label="collection description"
          placeholder="Add a line about what this is for"
          style={styles.reasonGrow}
          onSave={(next) => void rename(c.id, c.name, next)}
        />
      )}
      <div {...stylex.props(styles.actions)}>
        <button
          type="button"
          {...stylex.props(styles.quiet)}
          onClick={() => pushModal({ kind: 'dialog', id: 'renameCollection', collectionId: c.id })}
        >
          <Pencil size={12} strokeWidth={1.75} aria-hidden />
          Edit
        </button>
        <button
          type="button"
          {...stylex.props(styles.quiet, styles.danger)}
          onClick={() => pushModal({ kind: 'dialog', id: 'deleteCollection', collectionId: c.id })}
        >
          <Trash2 size={12} strokeWidth={1.75} aria-hidden />
          Delete
        </button>
      </div>
    </div>
  )
}

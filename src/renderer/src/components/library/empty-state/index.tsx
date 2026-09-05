import * as stylex from '@stylexjs/stylex'
import { COPY } from '../../../../../shared/constants'
import { useLibrary } from '../../../state/library'
import { useSettings } from '../../../state/settings'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Kbd } from '../../common'
import { styles } from './styles'

export type EmptyKind = 'library' | 'collection' | 'trash' | 'filtered' | 'links' | 'files'

const QUIET_COPY: Record<Exclude<EmptyKind, 'library'>, { line: string; sub?: string }> = {
  collection: {
    line: COPY.emptyCollection,
    sub: 'Drop onto this collection in the sidebar, or wait for the agent to notice a match.'
  },
  trash: { line: COPY.trashEmpty },
  links: { line: 'No links yet.', sub: 'Drag a link from your browser, or paste one with ⌘V.' },
  files: { line: 'No files yet.', sub: 'Drop files or folders anywhere in this window.' },
  filtered: { line: 'Nothing matches these filters.' }
}

/** Hint about the AI being off or offline, linking to Settings. Nothing when connected. */
function AiHint(): React.JSX.Element | null {
  const status = useSettings((s) => s.stats?.aiStatus)
  const openSettings = useUi((s) => s.openSettings)
  if (!status || status === 'connected') return null
  const label =
    status === 'offline'
      ? 'Offline — things are kept and understood later.'
      : status === 'off'
        ? 'AI is off. Things are kept, not understood.'
        : 'Connect GMI in Settings to understand what you keep.'
  return (
    <button type="button" {...stylex.props(styles.aiHint)} onClick={openSettings}>
      <span {...stylex.props(styles.aiDot, status === 'offline' && styles.aiDotOffline)} aria-hidden="true" />
      {label}
    </button>
  )
}

/** Editorial hero for the empty library; one quiet line elsewhere. */
export function EmptyState({ kind }: { kind: EmptyKind }): React.JSX.Element {
  const setTypes = useLibrary((s) => s.setTypes)
  if (kind === 'library') {
    return (
      <section {...stylex.props(styles.empty)} aria-label="Empty library">
        <h2 {...stylex.props(styles.hero)}>
          {COPY.tagline}
          <br />
          <em {...stylex.props(styles.heroRest)}>{COPY.taglineRest}</em>
        </h2>
        <p {...stylex.props(styles.hint)}>
          <span>{COPY.dropHint}</span>
          <span {...stylex.props(styles.sep)} aria-hidden="true" />
          <span>
            Paste a link <Kbd>⌘V</Kbd>
          </span>
          <span {...stylex.props(styles.sep)} aria-hidden="true" />
          <span>
            Search or ask <Kbd>⌘K</Kbd>
          </span>
        </p>
        <AiHint />
      </section>
    )
  }
  const copy = QUIET_COPY[kind]
  return (
    <section {...stylex.props(styles.empty)}>
      <p {...stylex.props(styles.quiet)}>{copy.line}</p>
      {copy.sub ? <p {...stylex.props(styles.quietSub)}>{copy.sub}</p> : null}
      {kind === 'filtered' ? (
        <p {...stylex.props(styles.quietSub)}>
          <button type="button" {...stylex.props(shared.hoverFade, styles.linkButton)} onClick={() => setTypes([])}>
            Show all types
          </button>
        </p>
      ) : null}
      {kind === 'collection' ? <AiHint /> : null}
    </section>
  )
}

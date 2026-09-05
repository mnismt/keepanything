import * as stylex from '@stylexjs/stylex'
import { COPY } from '../../../../../shared/constants'
import { useSettings } from '../../../state/settings'
import { useUi } from '../../../state/ui'
import { styles } from './styles'

/** "Local only" / "Local · GMI connected" / "Local · offline — AI paused". Click -> Settings. */
export function LocalStatusFooter(): React.JSX.Element {
  const stats = useSettings((s) => s.stats)
  const openSettings = useUi((s) => s.openSettings)
  const status = stats?.aiStatus ?? 'unconfigured'
  const label = status === 'connected' ? COPY.localConnected : status === 'offline' ? COPY.localOffline : COPY.localOnly
  return (
    <button type="button" {...stylex.props(styles.footer)} onClick={openSettings} title="Privacy and AI settings">
      <span
        {...stylex.props(
          styles.dot,
          status === 'offline' && styles.offline,
          status !== 'connected' && status !== 'offline' && styles.off
        )}
        aria-hidden="true"
      />
      <span>{label}</span>
    </button>
  )
}

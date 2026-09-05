import * as stylex from '@stylexjs/stylex'
import { isFailed, isTerminal } from '../../../../../shared/status'
import type { ProcessingStatus } from '../../../../../shared/types'
import { styles } from './styles'

export type DotTone = 'neutral' | 'processing' | 'failed' | 'ok' | 'waiting'

/** Tone for an item status: pulsing while working, red on failure, quiet otherwise. */
export function toneForStatus(status: ProcessingStatus): DotTone {
  if (isFailed(status)) return 'failed'
  if (status === 'WAITING_FOR_AI') return 'waiting'
  if (status === 'PARTIAL') return 'neutral'
  if (!isTerminal(status)) return 'processing'
  return 'ok'
}

/** 6 px status dot. */
export function Dot({ tone = 'neutral', title }: { tone?: DotTone; title?: string }): React.JSX.Element {
  return <span {...stylex.props(styles.dot, tone !== 'neutral' && styles[tone])} title={title} aria-hidden="true" />
}

import * as stylex from '@stylexjs/stylex'
import { useId, useState } from 'react'
import { colors } from '../../../styles/tokens.stylex'
import { CYCLE_MS, styles } from './styles'

/**
 * The app mark: three shapes falling one at a time behind the shelf lip. Every instance shares
 * the document timeline's phase, so two marks on screen at once fall together.
 */
export function BrandMark({ size = 18 }: { size?: number }): React.JSX.Element {
  const clipId = useId()
  const [phase] = useState(() => -(Number(document.timeline.currentTime ?? 0) % CYCLE_MS))
  return (
    <svg {...stylex.props(styles.mark(size))} viewBox="0 0 36 36" role="img" aria-label="KeepAnything">
      <defs>
        <clipPath id={clipId}>
          <rect width="36" height="21" />
        </clipPath>
      </defs>
      <rect width="36" height="36" rx="9" fill={colors.accent} />
      <g clipPath={`url(#${clipId})`}>
        <rect
          {...stylex.props(styles.drop, styles.restA, styles.phase(0, phase))}
          x="10"
          y="5"
          width="16"
          height="15"
          rx="2"
          fill={colors.paper}
        />
        <circle
          {...stylex.props(styles.drop, styles.restB, styles.phase(CYCLE_MS / 3, phase))}
          cx="18"
          cy="12"
          r="7"
          fill={colors.paper}
        />
        <rect
          {...stylex.props(styles.drop, styles.restC, styles.phase((CYCLE_MS / 3) * 2, phase))}
          x="7"
          y="9"
          width="22"
          height="9"
          rx="2"
          fill={colors.paper}
        />
      </g>
      <rect x="6" y="20" width="24" height="3" rx="1.5" fill={colors.ink} />
    </svg>
  )
}

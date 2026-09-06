import * as stylex from '@stylexjs/stylex'
import { useId } from 'react'
import { colors } from '../../styles/tokens.stylex'
import { styles } from './styles'

// Same mark and two-line wordmark as the app sidebar, without its drop animation.
export function Brand() {
  const clipId = useId()
  return (
    <a href="/" aria-label="KeepAnything" {...stylex.props(styles.root)}>
      <svg viewBox="0 0 36 36" aria-hidden="true" {...stylex.props(styles.mark)}>
        <defs>
          <clipPath id={clipId}>
            <rect width="36" height="21" />
          </clipPath>
        </defs>
        <rect width="36" height="36" rx="9" fill={colors.accent} />
        <g clipPath={`url(#${clipId})`}>
          <rect x="10" y="5" width="16" height="15" rx="2" fill={colors.paper} />
          <circle cx="18" cy="12" r="7" fill={colors.paper} />
          <rect x="7" y="9" width="22" height="9" rx="2" fill={colors.paper} />
        </g>
        <rect x="6" y="20" width="24" height="3" rx="1.5" fill={colors.ink} />
      </svg>
      <span {...stylex.props(styles.word)}>
        <span {...stylex.props(styles.keep)}>Keep</span>
        <span {...stylex.props(styles.anything)}>Anything</span>
      </span>
    </a>
  )
}

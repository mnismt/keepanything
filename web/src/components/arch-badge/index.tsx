import * as stylex from '@stylexjs/stylex'
import { styles } from './styles'

export type MacArch = 'arm64' | 'x64'

export const ARCH_LABEL: Record<MacArch, string> = { arm64: 'Apple Silicon', x64: 'Intel' }

// Mounted only once detection resolves, so the mount animation doubles as the reveal.
export function ArchBadge({ arch, kind = 'primary' }: { arch: MacArch; kind?: 'primary' | 'quiet' }) {
  return (
    <span {...stylex.props(styles.root, kind === 'quiet' && styles.quiet)}>
      <svg
        width={12}
        height={12}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...stylex.props(styles.svg)}
      >
        <rect x="4" y="4" width="16" height="16" rx="3" pathLength={1} {...stylex.props(styles.stroke)} />
        <rect x="9" y="9" width="6" height="6" rx="1" pathLength={1} {...stylex.props(styles.stroke, styles.inner)} />
        <g {...stylex.props(styles.pins)}>
          <path d="M9 2v2M15 2v2M9 20v2M15 20v2M2 9h2M2 15h2M20 9h2M20 15h2" />
        </g>
      </svg>
      <span {...stylex.props(styles.label)}>{ARCH_LABEL[arch]}</span>
    </span>
  )
}

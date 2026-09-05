import * as stylex from '@stylexjs/stylex'
import { colors, media } from '../../../styles/tokens.stylex'

const pulse = stylex.keyframes({
  '0%': { opacity: 1 },
  '50%': { opacity: 0.35 },
  '100%': { opacity: 1 }
})

export const styles = stylex.create({
  dot: {
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: colors.fg3,
    flexShrink: 0
  },
  processing: {
    backgroundColor: colors.accent,
    animationName: { default: pulse, [media.reducedMotion]: 'none' },
    animationDuration: '1.2s',
    animationTimingFunction: 'ease-in-out',
    animationIterationCount: 'infinite'
  },
  failed: { backgroundColor: colors.danger },
  ok: { backgroundColor: colors.ok },
  waiting: { backgroundColor: colors.fg4 }
})

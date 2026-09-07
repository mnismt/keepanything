import * as stylex from '@stylexjs/stylex'
import { colors, motion, space, text, weight } from '../../styles/tokens.stylex'

const REDUCED = '@media (prefers-reduced-motion: reduce)'

// Drops onto the corner from above, like a tag being clipped on.
const settle = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(-6px)' },
  to: { opacity: 1, transform: 'translateY(0)' }
})

// Every path carries pathLength="1", so one dash of length 1 draws any segment regardless of its
// real geometry.
const draw = stylex.keyframes({
  from: { strokeDashoffset: 1 },
  to: { strokeDashoffset: 0 }
})

const fade = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 }
})

const NOTCH = 4

export const styles = stylex.create({
  // Bookmark ribbon clipped onto the button's top-right corner: most of it sits above the edge, the
  // notched tail overlaps the button's top padding and stays clear of the label's cap height.
  root: {
    position: 'absolute',
    top: -15,
    right: 10,
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: space.s1,
    paddingInline: 6,
    paddingBlockStart: 4,
    paddingBlockEnd: 4 + NOTCH,
    clipPath: `polygon(0 0, 100% 0, 100% 100%, 50% calc(100% - ${NOTCH}px), 0 100%)`,
    fontSize: text.t11,
    fontWeight: weight.medium,
    lineHeight: 1,
    letterSpacing: '0.01em',
    color: colors.fgOnAccent,
    backgroundColor: colors.accent,
    animationName: settle,
    animationDuration: motion.glide,
    animationTimingFunction: motion.easeSettle,
    animationFillMode: 'both'
  },
  quiet: {
    color: colors.fg1,
    backgroundColor: colors.bg3
  },
  svg: {
    display: 'block',
    flexShrink: 0
  },
  stroke: {
    strokeDasharray: 1,
    animationName: draw,
    animationDuration: { default: '520ms', [REDUCED]: '0ms' },
    animationTimingFunction: motion.easeInOut,
    animationFillMode: 'both'
  },
  inner: {
    animationDelay: { default: '160ms', [REDUCED]: '0ms' }
  },
  pins: {
    animationName: fade,
    animationDuration: motion.slow,
    animationDelay: { default: '420ms', [REDUCED]: '0ms' },
    animationTimingFunction: motion.easeOut,
    animationFillMode: 'both'
  },
  label: {
    animationName: fade,
    animationDuration: motion.slow,
    animationDelay: { default: '200ms', [REDUCED]: '0ms' },
    animationTimingFunction: motion.easeOut,
    animationFillMode: 'both'
  }
})

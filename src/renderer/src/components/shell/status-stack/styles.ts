import * as stylex from '@stylexjs/stylex'
import { colors, motion, radii, shadows, space, text, zIndex } from '../../../styles/tokens.stylex'

const rise = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(6px)' },
  to: { opacity: 1, transform: 'none' }
})

const enter = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(3px)' },
  to: { opacity: 1, transform: 'translateY(0)' }
})

export const styles = stylex.create({
  stack: {
    position: 'fixed',
    right: space.s5,
    bottom: space.s5,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: space.s2,
    zIndex: zIndex.status,
    pointerEvents: 'none'
  },
  entry: {
    pointerEvents: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    minWidth: 240,
    maxWidth: 360,
    paddingBlock: 10,
    paddingInline: 14,
    borderRadius: radii.r2,
    backgroundColor: colors.bg3,
    backdropFilter: 'blur(24px)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    boxShadow: shadows.pop,
    fontSize: text.t13,
    color: colors.fg1,
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut
  },
  line: { display: 'flex', alignItems: 'center', gap: space.s2, minWidth: 0 },
  lineText: { flexGrow: 1, minWidth: 0 },
  toggle: {
    display: 'inline-flex',
    color: { default: colors.fg4, ':hover': colors.fg1 },
    borderRadius: 4,
    padding: 2
  },
  rows: { display: 'flex', flexDirection: 'column', gap: 4, paddingLeft: 14, color: colors.fg3, fontSize: text.t12 },
  row: { display: 'flex', alignItems: 'center', gap: space.s2, minWidth: 0 },
  rowTitle: { flexGrow: 1, minWidth: 0, color: colors.fg2 },
  rowStage: { color: colors.fg4, whiteSpace: 'nowrap' },
  action: {
    fontSize: text.t12,
    color: { default: colors.fg3, ':hover': colors.fg1 },
    whiteSpace: 'nowrap',
    borderRadius: 4,
    paddingInline: 4
  },
  steps: { display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 14, color: colors.fg3, fontSize: text.t12 },
  stepEnter: {
    animationName: enter,
    animationDuration: motion.slow,
    animationTimingFunction: motion.easeSettle,
    animationFillMode: 'both'
  }
})

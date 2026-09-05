import * as stylex from '@stylexjs/stylex'
import { colors, motion, radii, shadows, space, text, weight } from '../../../styles/tokens.stylex'

const rise = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(6px)' },
  to: { opacity: 1, transform: 'none' }
})

export const styles = stylex.create({
  toast: {
    pointerEvents: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: space.s3,
    minWidth: 200,
    maxWidth: 380,
    paddingTop: 10,
    paddingBottom: 10,
    paddingRight: 12,
    paddingLeft: 14,
    borderRadius: radii.r2,
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    boxShadow: shadows.pop,
    color: colors.fg1,
    fontSize: text.t13,
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut
  },
  text: { flexGrow: 1, minWidth: 0 },
  detail: { display: 'block', color: colors.fg3, fontSize: text.t12, marginTop: 2 },
  secondary: { fontWeight: weight.regular, color: { default: colors.fg3, ':hover': colors.fg1 } },
  action: {
    flexShrink: 0,
    fontWeight: weight.medium,
    color: { default: colors.fg2, ':hover': colors.fg1 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    paddingBlock: 2,
    paddingInline: 6,
    borderRadius: 4
  },
  close: {
    flexShrink: 0,
    display: 'inline-flex',
    color: { default: colors.fg4, ':hover': colors.fg1 },
    padding: 2,
    borderRadius: 4
  }
})

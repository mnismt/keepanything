import * as stylex from '@stylexjs/stylex'
import { colors, motion, radii, space, text, weight } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  button: {
    display: 'inline-flex',
    alignItems: 'center',
    flexShrink: 0,
    gap: space.s2,
    height: 28,
    paddingInline: space.s3,
    borderRadius: radii.r1,
    fontSize: text.t13,
    fontWeight: weight.medium,
    color: colors.fg1,
    backgroundColor: { default: colors.bg2, ':hover': colors.bg3, ':active': colors.bgActive },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: colors.hairline, ':hover': colors.hairlineStrong },
    transitionProperty: 'background-color, border-color, color, opacity',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut,
    whiteSpace: 'nowrap',
    opacity: { default: 1, ':disabled': 0.45 },
    pointerEvents: { default: 'auto', ':disabled': 'none' }
  },
  primary: {
    backgroundColor: { default: colors.fg1, ':hover': colors.fg1 },
    color: colors.bg0,
    borderColor: { default: 'transparent', ':hover': 'transparent' },
    opacity: { default: 1, ':hover': 0.92, ':disabled': 0.45 }
  },
  quiet: {
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    borderColor: { default: 'transparent', ':hover': 'transparent' },
    color: { default: colors.fg2, ':hover': colors.fg1 }
  },
  danger: {
    color: { default: colors.danger, ':hover': colors.danger }
  },
  icon: {
    width: 28,
    paddingInline: 0,
    justifyContent: 'center'
  },
  small: {
    height: 24,
    fontSize: text.t12,
    paddingInline: space.s2
  },
  smallIcon: {
    width: 24,
    paddingInline: 0
  }
})

import * as stylex from '@stylexjs/stylex'
import { colors, motion, radii, space, text, weight } from '../../styles/tokens.stylex'

export const styles = stylex.create({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: 38,
    columnGap: space.s2,
    paddingInline: space.s4,
    borderRadius: radii.r1,
    fontSize: text.t13,
    fontWeight: weight.medium,
    whiteSpace: 'nowrap',
    color: colors.fg1,
    backgroundColor: { default: colors.bg2, ':hover': colors.bg3 },
    boxShadow: `inset 0 0 0 1px ${colors.hairline}`,
    transitionProperty: 'background-color, opacity',
    transitionDuration: motion.base,
    transitionTimingFunction: motion.easeOut
  },
  primary: {
    color: colors.bg0,
    backgroundColor: { default: colors.fg1, ':hover': colors.fg1 },
    boxShadow: 'none',
    opacity: { default: 1, ':hover': 0.92 }
  }
})

import * as stylex from '@stylexjs/stylex'
import { colors, layout, motion, radii, space, text } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingInline: layout.contentPad,
    paddingBottom: space.s4,
    maxWidth: 760
  },
  reasonLead: { color: colors.fg3 },
  actions: { display: 'flex', gap: space.s2, marginTop: space.s2, marginInlineStart: -6 },
  quiet: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    paddingInline: 6,
    paddingBlock: 3,
    fontSize: text.t12,
    color: { default: colors.fg3, ':hover': colors.fg1 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    borderRadius: radii.r1,
    transitionProperty: 'color, background-color',
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut
  },
  danger: { color: { default: colors.fg3, ':hover': colors.danger } }
})

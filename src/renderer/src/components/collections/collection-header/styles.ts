import * as stylex from '@stylexjs/stylex'
import { colors, layout, motion, radii, space, text } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: space.s3,
    paddingInline: layout.contentPad,
    paddingBottom: space.s4
  },
  reason: { fontSize: text.t13, color: colors.fg2, lineHeight: 1.5 },
  reasonGrow: { flexGrow: 1, minWidth: 0, maxWidth: 760 },
  reasonLead: { color: colors.fg3 },
  actions: { display: 'flex', gap: space.s2, flexShrink: 0 },
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

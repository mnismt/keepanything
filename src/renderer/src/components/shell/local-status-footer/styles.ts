import * as stylex from '@stylexjs/stylex'
import { colors, radii, space, text } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: space.s2,
    width: '100%',
    height: 28,
    paddingInline: space.s3,
    borderRadius: radii.r1,
    fontSize: text.t12,
    color: { default: colors.fg3, ':hover': colors.fg2 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    textAlign: 'left'
  },
  dot: { width: 6, height: 6, borderRadius: '50%', backgroundColor: colors.ok, flexShrink: 0 },
  off: { backgroundColor: colors.fg4 },
  offline: { backgroundColor: colors.danger }
})

import * as stylex from '@stylexjs/stylex'
import { colors, radii, shadows } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  trigger: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: radii.r1,
    color: { default: colors.fg2, ':hover': colors.fg1 },
    backgroundColor: colors.bg3,
    backdropFilter: 'blur(24px)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    boxShadow: shadows.lift
  }
})

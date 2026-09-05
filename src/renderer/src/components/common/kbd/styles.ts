import * as stylex from '@stylexjs/stylex'
import { colors, fonts, text, weight } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  kbd: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 18,
    height: 18,
    paddingInline: 5,
    borderRadius: 4,
    fontFamily: fonts.sans,
    fontSize: text.t11,
    fontWeight: weight.medium,
    color: colors.fg3,
    backgroundColor: colors.bgHover,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    lineHeight: 1,
    letterSpacing: '0.02em'
  }
})

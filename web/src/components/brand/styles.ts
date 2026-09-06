import * as stylex from '@stylexjs/stylex'
import { colors, fonts, space, text, weight } from '../../styles/tokens.stylex'

export const styles = stylex.create({
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: space.s2,
    color: colors.fg1
  },
  mark: {
    width: 24,
    height: 24,
    flexShrink: 0
  },
  word: {
    display: 'flex',
    flexDirection: 'column',
    lineHeight: 1
  },
  keep: {
    fontSize: text.t11,
    fontWeight: weight.semibold,
    letterSpacing: '0.02em'
  },
  anything: {
    marginBlockStart: 2,
    fontFamily: fonts.serif,
    fontStyle: 'italic',
    fontSize: text.t13,
    color: colors.fg3
  }
})

import * as stylex from '@stylexjs/stylex'
import { colors, layout, space, text } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: space.s2,
    paddingInline: layout.contentPad,
    paddingBottom: space.s2,
    color: colors.fg3,
    fontSize: text.t12
  },
  spacer: { flexGrow: 1 }
})

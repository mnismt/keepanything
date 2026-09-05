import * as stylex from '@stylexjs/stylex'
import { colors, radii, space, text } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  box: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.s2,
    paddingBlock: space.s3,
    paddingInline: space.s3,
    borderRadius: radii.r2,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    backgroundColor: colors.bg2,
    backdropFilter: 'blur(24px)'
  },
  list: { display: 'flex', flexDirection: 'column', gap: 4, margin: 0, padding: 0, listStyleType: 'none' },
  item: {
    display: 'flex',
    alignItems: 'baseline',
    gap: space.s2,
    fontSize: text.t13,
    color: colors.fg2,
    lineHeight: 1.5
  },
  bullet: { color: colors.fg4, flexShrink: 0 },
  confidence: { color: colors.fg4, fontSize: text.t12, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' },
  foot: { display: 'flex', alignItems: 'center', gap: space.s2, marginTop: space.s1 },
  applied: { fontSize: text.t12, color: colors.fg3, flexGrow: 1 }
})

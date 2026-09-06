import * as stylex from '@stylexjs/stylex'
import { colors, fonts, radii, shadows, space, text, weight } from '../../styles/tokens.stylex'

const MOBILE = '@media (max-width: 800px)'

export const styles = stylex.create({
  frame: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    overflow: 'hidden',
    borderRadius: radii.r3,
    backgroundColor: colors.bg2
  },
  ratio: (ratio: string) => ({ aspectRatio: ratio }),
  sheet: {
    boxShadow: `inset 0 0 0 1px ${colors.hairline}, ${shadows.sheet}`
  },
  pop: {
    boxShadow: `inset 0 0 0 1px ${colors.hairline}, ${shadows.pop}`
  },
  img: {
    width: '100%',
    height: '100%',
    objectFit: 'cover'
  },
  label: {
    fontSize: text.t12,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: colors.fg4
  },
  caption: {
    position: 'absolute',
    insetInlineStart: { default: space.s6, [MOBILE]: space.s4 },
    insetBlockEnd: { default: space.s6, [MOBILE]: space.s4 },
    paddingInline: space.s4,
    paddingBlock: space.s3,
    borderRadius: radii.r2,
    backgroundColor: colors.overlayDark,
    backdropFilter: 'blur(20px)',
    fontFamily: fonts.serif,
    fontWeight: weight.regular,
    fontSize: { default: text.t28, [MOBILE]: text.t20 },
    lineHeight: 1.15,
    letterSpacing: '-0.01em',
    color: colors.onMedia,
    maxInlineSize: '18ch',
    textWrap: 'balance'
  }
})

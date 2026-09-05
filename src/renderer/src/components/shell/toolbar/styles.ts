import * as stylex from '@stylexjs/stylex'
import { colors, layout, motion, radii, space, text, weight } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: space.s2,
    height: layout.titlebarHeight,
    paddingInline: layout.contentPad,
    flexShrink: 0
  },
  title: {
    fontSize: text.t15,
    fontWeight: weight.semibold,
    letterSpacing: '-0.01em',
    color: colors.fg1,
    marginRight: space.s2
  },
  meta: { fontSize: text.t12, color: colors.fg4, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
  spacer: { flexGrow: 1, height: '100%' },
  search: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.s2,
    height: 28,
    width: 260,
    minWidth: 0,
    flexShrink: 1,
    paddingRight: space.s2,
    paddingLeft: space.s3,
    borderRadius: radii.r1,
    backgroundColor: colors.bg2,
    backdropFilter: 'blur(24px)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: colors.hairline, ':hover': colors.hairlineStrong },
    color: { default: colors.fg3, ':hover': colors.fg2 },
    fontSize: text.t13,
    textAlign: 'left',
    transitionProperty: 'border-color, color',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut
  },
  searchText: { flexGrow: 1, minWidth: 0 },
  control: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    height: 28,
    borderRadius: radii.r1,
    color: { default: colors.fg3, ':hover': colors.fg1 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover }
  },
  select: {
    appearance: 'none',
    height: 28,
    paddingRight: 24,
    paddingLeft: space.s2,
    borderRadius: radii.r1,
    color: 'inherit',
    fontSize: text.t12,
    backgroundColor: 'transparent'
  },
  chevron: { position: 'absolute', right: 6, pointerEvents: 'none' },
  seg: {
    display: 'inline-flex',
    height: 28,
    borderRadius: radii.r1,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    overflow: 'hidden'
  },
  segBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 30,
    color: { default: colors.fg3, ':hover': colors.fg1 }
  },
  segOn: { color: colors.fg1, backgroundColor: colors.bgActive }
})

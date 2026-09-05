import * as stylex from '@stylexjs/stylex'
import { colors, layout, motion, radii, space, text, weight } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    width: layout.sidebarWidth,
    height: '100%',
    backgroundColor: colors.bg1,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: colors.hairline,
    flexShrink: 0
  },
  drag: {
    height: layout.titlebarHeight,
    display: 'flex',
    alignItems: 'flex-end',
    paddingRight: space.s4,
    paddingBottom: 6,
    paddingLeft: 84,
    flexShrink: 0
  },
  brand: { fontSize: text.t13, fontWeight: weight.semibold, letterSpacing: '-0.01em', color: colors.fg2 },
  nav: { flexGrow: 1, overflowY: 'auto', paddingTop: space.s2, paddingInline: space.s2, paddingBottom: space.s4 },
  group: { marginTop: space.s5 },
  groupHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: space.s2,
    paddingBottom: space.s1,
    paddingLeft: space.s3,
    fontSize: text.t11,
    fontWeight: weight.medium,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: colors.fg4
  },
  groupAdd: {
    display: 'inline-flex',
    color: { default: colors.fg4, ':hover': colors.fg1 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    padding: 2,
    borderRadius: 4
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: space.s2,
    width: '100%',
    height: 28,
    paddingRight: space.s2,
    paddingLeft: space.s3,
    borderRadius: radii.r1,
    color: { default: colors.fg2, ':hover': colors.fg1 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    textAlign: 'left',
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: 'transparent',
    transitionProperty: 'background-color, color',
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut
  },
  rowCurrent: {
    backgroundColor: { default: colors.bgActive, ':hover': colors.bgActive },
    color: { default: colors.fg1, ':hover': colors.fg1 }
  },
  rowDrop: { borderColor: colors.accent },
  icon: {
    flexShrink: 0,
    color: colors.fg3,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16
  },
  iconCurrent: { color: colors.fg1 },
  label: { flexGrow: 1, minWidth: 0 },
  count: { fontSize: text.t11, color: colors.fg4, fontVariantNumeric: 'tabular-nums' },
  swatch: { width: 8, height: 8, borderRadius: 2, backgroundColor: colors.fg4, marginInline: 4, flexShrink: 0 },
  swatchAi: { borderRadius: '50%' },
  swatchColor: (color: string) => ({ backgroundColor: color }),
  empty: { paddingBlock: space.s1, paddingInline: space.s3, fontSize: text.t12, color: colors.fg4 },
  bottom: {
    padding: space.s2,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.hairline,
    flexShrink: 0
  }
})

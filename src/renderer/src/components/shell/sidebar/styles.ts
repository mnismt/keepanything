import * as stylex from '@stylexjs/stylex'
import { colors, fonts, layout, motion, radii, space, text, weight } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  sidebar: {
    display: 'flex',
    flexDirection: 'column',
    width: layout.sidebarWidth,
    height: '100%',
    backgroundColor: colors.glassSide,
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: colors.hairline,
    flexShrink: 0
  },
  drag: {
    height: layout.titlebarHeight,
    display: 'flex',
    alignItems: 'flex-start',
    paddingRight: space.s4,
    // Traffic lights sit at x 16 / y 18 with a 12 px diameter and 8 px gaps (library-window.ts):
    // they end at x 68 and their centre line is y 24.
    paddingTop: 15,
    paddingLeft: 92,
    flexShrink: 0
  },
  logo: { display: 'flex', alignItems: 'center', gap: space.s2 },
  wordmark: {
    display: 'flex',
    flexDirection: 'column',
    fontSize: text.t11,
    lineHeight: '9px',
    letterSpacing: '-0.01em',
    color: colors.fg2,
    userSelect: 'none'
  },
  wordKeep: { fontWeight: weight.semibold },
  wordAnything: { fontFamily: fonts.serif, fontStyle: 'italic', fontSize: text.t12, color: colors.fg3 },
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
    borderRadius: 4,
    transitionProperty: 'background-color, border-color, color, opacity',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut
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
    transitionProperty: 'background-color, border-color, color, opacity',
    transitionDuration: motion.slow,
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
  },
  bottomRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: space.s2 },
  status: { display: 'flex', alignItems: 'center', gap: space.s1, paddingInline: space.s1, cursor: 'default' },
  statusMark: { display: 'flex', alignItems: 'center', color: colors.accent, flexShrink: 0 },
  statusMarkOffline: { color: colors.fg3 },
  statusMarkOff: { color: colors.fg4 },
  statusLabel: { fontSize: text.t11, color: colors.fg4, whiteSpace: 'nowrap' }
})

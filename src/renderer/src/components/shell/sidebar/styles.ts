import * as stylex from '@stylexjs/stylex'
import { colors, fonts, layout, motion, radii, space, text, weight } from '../../../styles/tokens.stylex'

const REDUCED = '@media (prefers-reduced-motion: reduce)'

// One item at a time: each shape owns a third of the cycle. The fall itself is short (~1.5 s);
// the rest of the third is a pause out of frame so the mark stays calm in peripheral vision.
const drop = stylex.keyframes({
  '0%': { transform: 'translateY(-24px) rotate(-14deg)', animationTimingFunction: 'cubic-bezier(0.5, 0, 0.9, 0.5)' },
  '10%': { transform: 'translateY(0) rotate(-4deg)', animationTimingFunction: 'cubic-bezier(0.2, 0.8, 0.3, 1)' },
  '15%': { transform: 'translateY(0) rotate(-4deg)', animationTimingFunction: 'cubic-bezier(0.5, 0, 1, 0.6)' },
  '22%': { transform: 'translateY(20px) rotate(0deg)' },
  '100%': { transform: 'translateY(20px) rotate(0deg)' }
})

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
    alignItems: 'flex-start',
    paddingRight: space.s4,
    // Traffic lights sit at x 16 / y 18 with a 12 px diameter and 8 px gaps (library-window.ts):
    // they end at x 68 and their centre line is y 24.
    paddingTop: 15,
    paddingLeft: 92,
    flexShrink: 0
  },
  logo: { display: 'flex', alignItems: 'center', gap: space.s2 },
  mark: { width: 18, height: 18, flexShrink: 0 },
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
  drop: {
    transformBox: 'fill-box',
    transformOrigin: 'center',
    animationName: { default: drop, [REDUCED]: 'none' },
    animationDuration: '12000ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite'
  },
  dropA: { transform: 'translateY(0) rotate(-10deg)', animationDelay: '0ms' },
  dropB: { transform: 'translateY(0) rotate(0deg)', animationDelay: '4000ms' },
  dropC: { transform: 'translateY(0) rotate(6deg)', animationDelay: '8000ms' },
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

import * as stylex from '@stylexjs/stylex'
import { colors, fonts, motion, radii, shadows, space, text, weight, zIndex } from '../../../styles/tokens.stylex'

const fade = stylex.keyframes({ from: { opacity: 0 } })
const rise = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(-8px)' } })

export const styles = stylex.create({
  scrim: {
    position: 'absolute',
    inset: 0,
    zIndex: zIndex.dialog,
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    paddingTop: '6vh',
    backgroundColor: colors.scrim,
    animationName: fade,
    animationDuration: motion.fast,
    animationTimingFunction: motion.easeOut
  },
  sheet: {
    width: 600,
    maxWidth: 'calc(100vw - 64px)',
    maxHeight: '88vh',
    overflowY: 'auto',
    borderRadius: radii.r3,
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    boxShadow: shadows.sheet,
    paddingTop: space.s5,
    paddingInline: space.s6,
    paddingBottom: space.s6,
    display: 'flex',
    flexDirection: 'column',
    gap: space.s5,
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: text.t20, fontWeight: weight.medium, letterSpacing: '-0.01em' },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: space.s3,
    paddingTop: space.s5,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.hairline
  },
  sectionHead: { display: 'flex', alignItems: 'baseline', gap: space.s2 },
  sectionTitle: { fontSize: text.t13, fontWeight: weight.medium },
  sectionSub: { fontSize: text.t12, color: colors.fg4 },
  row: {
    display: 'grid',
    gridTemplateColumns: '132px minmax(0, 1fr)',
    alignItems: 'center',
    columnGap: space.s3,
    rowGap: 6
  },
  label: { color: colors.fg2, fontSize: text.t13 },
  control: { display: 'flex', alignItems: 'center', gap: space.s2, minWidth: 0 },
  field: {
    flexGrow: 1,
    minWidth: 0,
    height: 30,
    paddingInline: space.s3,
    borderRadius: radii.r1,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: colors.hairline, ':focus-visible': colors.accent },
    outline: { default: 'none', ':focus-visible': 'none' },
    color: colors.fg1,
    '::placeholder': { color: colors.fg4 }
  },
  mono: { fontFamily: fonts.mono, fontSize: text.t12 },
  select: { appearance: 'none', paddingRight: space.s3 },
  hint: { gridColumn: 2, fontSize: text.t12, color: colors.fg3, lineHeight: 1.5 },
  ok: { color: colors.ok },
  bad: { color: colors.danger },
  seg: {
    display: 'inline-flex',
    height: 30,
    borderRadius: radii.r1,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    overflow: 'hidden',
    backgroundColor: colors.bg2
  },
  segBtn: {
    paddingInline: space.s3,
    fontSize: text.t13,
    color: { default: colors.fg3, ':hover': colors.fg1 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    borderRightWidth: 1,
    borderRightStyle: 'solid',
    borderRightColor: colors.hairline
  },
  segLast: { borderRightWidth: 0 },
  segOn: { color: colors.fg1, backgroundColor: colors.bgActive },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: space.s3 },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingBlock: space.s3,
    paddingInline: space.s3,
    borderRadius: radii.r2,
    backgroundColor: colors.bg2
  },
  statValue: {
    fontSize: text.t20,
    fontWeight: weight.medium,
    letterSpacing: '-0.01em',
    fontVariantNumeric: 'tabular-nums'
  },
  statLabel: { fontSize: text.t11, color: colors.fg3 },
  path: {
    fontFamily: fonts.mono,
    fontSize: text.t11,
    color: colors.fg3,
    overflowWrap: 'anywhere',
    flexGrow: 1,
    minWidth: 0
  },
  privacy: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: space.s4,
    fontSize: text.t12,
    color: colors.fg2,
    lineHeight: 1.5
  },
  privacyHead: { marginBottom: space.s1 },
  dangerBox: {
    display: 'flex',
    alignItems: 'center',
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s3,
    borderRadius: radii.r2,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline
  },
  dangerText: { flexGrow: 1, minWidth: 0, fontSize: text.t12, color: colors.fg3, lineHeight: 1.5 },
  dangerTitle: { color: colors.fg1, fontSize: text.t13, display: 'block' },
  masked: { fontFamily: fonts.mono, letterSpacing: '0.1em', color: colors.fg2, fontSize: text.t12 }
})

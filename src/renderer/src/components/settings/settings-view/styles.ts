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
    width: 620,
    maxWidth: 'calc(100vw - 64px)',
    maxHeight: '88vh',
    overflowY: 'auto',
    borderRadius: radii.r3,
    backgroundColor: colors.bg3,
    backdropFilter: 'blur(24px)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    boxShadow: shadows.sheet,
    paddingTop: space.s5,
    paddingInline: space.s6,
    paddingBottom: space.s6,
    display: 'flex',
    flexDirection: 'column',
    gap: space.s6,
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut
  },
  head: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: text.t20, fontWeight: weight.medium, letterSpacing: '-0.01em' },
  section: { display: 'flex', flexDirection: 'column', gap: space.s2 },
  sectionHead: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.s3,
    paddingInline: space.s1
  },
  sectionSub: { fontSize: text.t12, color: colors.fg4 },
  card: {
    borderRadius: radii.r2,
    backgroundColor: colors.bg2,
    backdropFilter: 'blur(24px)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    overflow: 'hidden'
  },
  provider: {
    display: 'flex',
    alignItems: 'center',
    gap: space.s3,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.hairline
  },
  providerMark: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    flexShrink: 0,
    borderRadius: radii.r1,
    backgroundColor: colors.bg3,
    backdropFilter: 'blur(24px)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    color: colors.fg1
  },
  providerText: { display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1, minWidth: 0 },
  providerName: { display: 'flex', alignItems: 'center', gap: space.s2, fontSize: text.t13, fontWeight: weight.medium },
  badge: {
    fontSize: text.t11,
    color: colors.fg3,
    paddingInline: 6,
    height: 18,
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: radii.r1,
    backgroundColor: colors.bgActive
  },
  providerSub: { fontSize: text.t12, color: colors.fg3 },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: space.s2,
    fontSize: text.t12,
    color: colors.fg3,
    flexShrink: 0
  },
  dot: { width: 6, height: 6, borderRadius: '50%', backgroundColor: colors.fg4 },
  dotOk: { backgroundColor: colors.ok },
  dotBad: { backgroundColor: colors.danger },
  row: {
    display: 'grid',
    gridTemplateColumns: '140px minmax(0, 1fr)',
    alignItems: 'center',
    columnGap: space.s3,
    rowGap: 6,
    minHeight: 48,
    paddingBlock: space.s2,
    paddingInline: space.s4,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: colors.hairline
  },
  label: { color: colors.fg1, fontSize: text.t13 },
  control: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: space.s2, minWidth: 0 },
  field: {
    flexGrow: 1,
    minWidth: 0,
    height: 28,
    paddingInline: space.s2,
    borderRadius: radii.r1,
    backgroundColor: colors.bg3,
    backdropFilter: 'blur(24px)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: colors.hairline, ':focus-visible': colors.accent },
    outline: { default: 'none', ':focus-visible': 'none' },
    color: colors.fg1,
    '::placeholder': { color: colors.fg4 }
  },
  mono: { fontFamily: fonts.mono, fontSize: text.t12 },
  hint: { gridColumn: 2, fontSize: text.t12, color: colors.fg4, lineHeight: 1.5 },
  ok: { color: colors.ok },
  bad: { color: colors.danger },
  seg: {
    display: 'inline-flex',
    height: 28,
    padding: 2,
    gap: 2,
    borderRadius: radii.r1,
    backgroundColor: colors.bg3,
    backdropFilter: 'blur(24px)',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline
  },
  segBtn: {
    paddingInline: space.s3,
    fontSize: text.t12,
    borderRadius: 4,
    color: { default: colors.fg3, ':hover': colors.fg1 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    transitionProperty: 'background-color, border-color, color, opacity',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut
  },
  segOn: { color: colors.fg1, backgroundColor: colors.bgActive },
  value: { fontSize: text.t12, color: colors.fg2, textAlign: 'right' },
  path: {
    fontFamily: fonts.mono,
    fontSize: text.t11,
    color: colors.fg3,
    overflowWrap: 'anywhere',
    flexGrow: 1,
    minWidth: 0,
    textAlign: 'right'
  },
  stats: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' },
  stat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderLeftWidth: { default: 1, ':first-child': 0 },
    borderLeftStyle: 'solid',
    borderLeftColor: colors.hairline
  },
  statValue: {
    fontSize: text.t20,
    fontWeight: weight.medium,
    letterSpacing: '-0.01em',
    fontVariantNumeric: 'tabular-nums'
  },
  statLabel: { fontSize: text.t11, color: colors.fg3 },
  privacy: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    fontSize: text.t12,
    color: colors.fg2,
    lineHeight: 1.5
  },
  privacyCol: {
    paddingBlock: space.s3,
    paddingInline: space.s4,
    borderLeftWidth: { default: 1, ':first-child': 0 },
    borderLeftStyle: 'solid',
    borderLeftColor: colors.hairline
  },
  privacyHead: { marginBottom: space.s1 },
  dangerBox: { display: 'flex', alignItems: 'center', gap: space.s3, paddingBlock: space.s3, paddingInline: space.s4 },
  dangerText: { flexGrow: 1, minWidth: 0, fontSize: text.t12, color: colors.fg3, lineHeight: 1.5 },
  dangerTitle: { color: colors.fg1, fontSize: text.t13, display: 'block' },
  masked: { fontFamily: fonts.mono, letterSpacing: '0.1em', color: colors.fg2, fontSize: text.t12, flexGrow: 1 }
})

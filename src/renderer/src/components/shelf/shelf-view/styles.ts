import * as stylex from '@stylexjs/stylex'
import { colors, fonts, motion, radii, shadows, space, text, weight } from '../../../styles/tokens.stylex'

const rise = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(6px)' } })

export const styles = stylex.create({
  shelf: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: colors.bg1,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairlineStrong,
    borderRadius: radii.r3,
    overflow: 'hidden',
    boxShadow: shadows.sheet,
    transitionProperty: 'border-color',
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut
  },
  shelfOver: { borderColor: colors.accent },
  // No wordmark: the panel says what to do with it, not what it is called. The strip stays as the
  // window's drag handle and as the slot for the flash and Clear.
  drag: {
    height: 30,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: space.s2,
    paddingInline: space.s3,
    fontSize: text.t11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: colors.fg4,
    flexShrink: 0
  },
  flash: { color: colors.fg2, textTransform: 'none', letterSpacing: 0, fontSize: text.t12 },
  clear: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    height: 20,
    paddingInline: 6,
    borderRadius: 4,
    fontSize: text.t11,
    letterSpacing: 0,
    textTransform: 'none',
    color: { default: colors.fg4, ':hover': colors.fg1 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover }
  },
  target: {
    marginInline: space.s2,
    marginBottom: space.s2,
    paddingBlock: space.s3,
    paddingInline: space.s3,
    borderRadius: radii.r2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.hairlineStrong,
    textAlign: 'center',
    color: colors.fg3,
    fontSize: text.t12,
    transitionProperty: 'border-color, color, background-color',
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
    flexShrink: 0
  },
  targetOver: { borderColor: colors.accent, color: colors.fg1, backgroundColor: colors.accentSoft },
  targetHero: { fontFamily: fonts.serif, fontSize: text.t15, color: colors.fg2, letterSpacing: '-0.005em' },
  list: {
    flexGrow: 1,
    overflowY: 'auto',
    paddingInline: space.s2,
    paddingBottom: space.s2,
    display: 'flex',
    flexDirection: 'column',
    gap: 2
  },
  tile: {
    display: 'grid',
    gridTemplateColumns: '36px 1fr 20px',
    gap: space.s2,
    alignItems: 'center',
    height: 44,
    paddingInline: space.s2,
    borderRadius: radii.r2,
    backgroundColor: { default: colors.bg2, ':hover': colors.bg3 },
    boxShadow: `0 0 0 1px ${colors.hairline} inset`,
    cursor: 'grab',
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut,
    outline: 'none'
  },
  tileFocus: {
    boxShadow: { default: `0 0 0 1px ${colors.hairline} inset`, ':focus-visible': `0 0 0 2px ${colors.accent}` }
  },
  thumb: { width: 36, height: 28, borderRadius: 4, overflow: 'hidden' },
  text: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 1, textAlign: 'left' },
  title: { fontSize: text.t12, color: colors.fg1, fontWeight: weight.medium },
  sub: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    fontSize: text.t11,
    color: colors.fg4,
    whiteSpace: 'nowrap',
    overflow: 'hidden'
  },
  peek: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 20,
    borderRadius: 4,
    color: { default: colors.fg4, ':hover': colors.fg1 },
    opacity: { default: 0, [stylex.when.ancestor(':hover')]: 1, ':focus-visible': 1 },
    transitionProperty: 'opacity',
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut
  },
  empty: {
    paddingBlock: space.s4,
    paddingInline: space.s3,
    textAlign: 'center',
    fontSize: text.t12,
    color: colors.fg4,
    lineHeight: 1.5
  }
})

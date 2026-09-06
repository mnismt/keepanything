import * as stylex from '@stylexjs/stylex'
import { colors, fonts, media, motion, radii, shadows, space, text, weight } from '../../../styles/tokens.stylex'

const rise = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(6px)' } })
// Overshoots a touch before settling, so the badge lands rather than fades in.
const pop = stylex.keyframes({
  '0%': { opacity: 0, transform: 'translateY(10px) scale(0.6)' },
  '60%': { opacity: 1, transform: 'translateY(-1px) scale(1.06)' },
  '100%': { opacity: 1, transform: 'translateY(0) scale(1)' }
})
const bob = stylex.keyframes({
  '0%': { transform: 'translateY(0)' },
  '50%': { transform: 'translateY(-2px)' },
  '100%': { transform: 'translateY(0)' }
})
// One dash period (4 on, 4 off) per loop, so the march is seamless.
const march = stylex.keyframes({ from: { strokeDashoffset: 0 }, to: { strokeDashoffset: -8 } })
const swap = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(4px)' } })

/** The body content trails the panel by this much on the way in, so the notch lands first. */
const STAGGER = { default: '90ms', [media.reducedMotion]: '0ms' }

export const styles = stylex.create({
  // The dock fills the transparent window; the notch shape and the body are layered inside it.
  // Off-screen states translate the whole thing into the edge; the window clips what pokes out.
  dock: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    willChange: 'transform, opacity'
  },
  dockIn: {
    transform: 'translateX(0)',
    opacity: 1,
    transitionProperty: 'transform, opacity',
    transitionDuration: `${motion.glide}, ${motion.base}`,
    transitionTimingFunction: `${motion.easeSettle}, ${motion.easeOut}`
  },
  dockOutRight: {
    transform: 'translateX(100%)',
    opacity: 0,
    transitionProperty: 'transform, opacity',
    transitionDuration: `${motion.slow}, ${motion.slow}`,
    transitionTimingFunction: `${motion.easeLeave}, ${motion.easeInOut}`
  },
  dockOutLeft: {
    transform: 'translateX(-100%)',
    opacity: 0,
    transitionProperty: 'transform, opacity',
    transitionDuration: `${motion.slow}, ${motion.slow}`,
    transitionTimingFunction: `${motion.easeLeave}, ${motion.easeInOut}`
  },
  // Hovered by a drag: the notch reaches out of the edge to meet the pointer. Scaled from the
  // edge rather than translated, so the fillets stay welded to the bezel.
  dockLeanRight: { transform: 'scaleX(1.025)', transformOrigin: 'right center' },
  dockLeanLeft: { transform: 'scaleX(1.025)', transformOrigin: 'left center' },
  shape: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    overflow: 'visible',
    // No `filter: drop-shadow` here: in a transparent window Chromium composites the filtered layer
    // against an opaque backdrop, which paints a pale slab over the whole window rectangle.
    pointerEvents: 'none'
  },
  // ponytail: translucent fill only. backdrop-filter cannot blur the desktop behind a transparent
  // window and native vibrancy would fill the whole rectangle, not the notch.
  shapeFill: {
    fill: colors.bg1,
    fillOpacity: 1,
    transitionProperty: 'fill',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut
  },
  shapeLine: {
    fill: 'none',
    stroke: colors.hairlineStrong,
    strokeWidth: 1,
    transitionProperty: 'stroke',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut
  },
  shapeLineOver: { stroke: colors.accent },
  // Geometry comes from `shared/layout` at render time: StyleX cannot read constants from a
  // non-`.stylex` module at compile time.
  body: (fillet: number, width: number) => ({
    position: 'absolute',
    top: fillet,
    bottom: fillet,
    width,
    display: 'flex',
    flexDirection: 'column',
    paddingBlock: space.s1,
    paddingInline: space.s1
  }),
  bodyRight: { right: 0 },
  bodyLeft: { left: 0 },
  bodyIn: {
    transform: 'translateX(0)',
    opacity: 1,
    transitionProperty: 'transform, opacity',
    transitionDuration: `${motion.glide}, ${motion.slow}`,
    transitionTimingFunction: `${motion.easeSettle}, ${motion.easeOut}`,
    transitionDelay: STAGGER
  },
  bodyOutRight: {
    transform: 'translateX(16px)',
    opacity: 0,
    transitionProperty: 'transform, opacity',
    transitionDuration: `${motion.base}, ${motion.fast}`,
    transitionTimingFunction: `${motion.easeLeave}, ${motion.easeInOut}`
  },
  bodyOutLeft: {
    transform: 'translateX(-16px)',
    opacity: 0,
    transitionProperty: 'transform, opacity',
    transitionDuration: `${motion.base}, ${motion.fast}`,
    transitionTimingFunction: `${motion.easeLeave}, ${motion.easeInOut}`
  },
  // No wordmark: the panel says what to do with it, not what it is called. The strip is the slot
  // for the flash and Clear.
  strip: {
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
  flash: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    color: colors.fg2,
    textTransform: 'none',
    letterSpacing: 0,
    fontSize: text.t12,
    animationName: pop,
    animationDuration: motion.glide,
    animationTimingFunction: motion.easeSettle,
    animationFillMode: 'both'
  },
  flashIcon: { color: colors.ok },
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
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: space.s2,
    marginInline: space.s2,
    marginBottom: space.s2,
    paddingBlock: space.s3,
    paddingInline: space.s3,
    borderRadius: radii.r2,
    textAlign: 'center',
    color: colors.fg3,
    fontSize: text.t12,
    boxShadow: '0 0 0 0 transparent',
    transitionProperty: 'color, background-color, box-shadow, transform',
    transitionDuration: `${motion.slow}, ${motion.slow}, ${motion.glide}, ${motion.glide}`,
    transitionTimingFunction: `${motion.easeOut}, ${motion.easeOut}, ${motion.easeSettle}, ${motion.easeSettle}`,
    flexShrink: 0
  },
  targetOver: {
    color: colors.fg1,
    backgroundColor: colors.accentSoft,
    boxShadow: `0 0 0 5px ${colors.accentSoft}`,
    transform: 'scale(1.02)'
  },
  // The dashed outline is an SVG so the dashes can march while a drag hovers.
  targetRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    overflow: 'visible',
    pointerEvents: 'none'
  },
  targetRingRect: {
    x: 0.5,
    y: 0.5,
    width: 'calc(100% - 1px)',
    height: 'calc(100% - 1px)',
    rx: radii.r2,
    fill: 'none',
    stroke: colors.hairlineStrong,
    strokeWidth: 1,
    strokeDasharray: '4 4',
    transitionProperty: 'stroke',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut
  },
  targetRingRectOver: {
    stroke: colors.accent,
    animationName: { default: march, [media.reducedMotion]: 'none' },
    animationDuration: '600ms',
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite'
  },
  targetHero: { fontFamily: fonts.serif, fontSize: text.t15, color: colors.fg2, letterSpacing: '-0.005em' },
  // Copy that replaces other copy (hero -> "Let go", hint -> flash) rises into place.
  swapIn: {
    animationName: swap,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut,
    animationFillMode: 'both'
  },
  peekBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.s2,
    paddingBlock: 4,
    paddingInline: 6,
    paddingRight: space.s3,
    borderRadius: 999,
    backgroundColor: colors.bg3,
    backdropFilter: 'blur(24px)',
    boxShadow: `0 0 0 1px ${colors.hairline} inset, ${shadows.lift}`,
    animationName: pop,
    animationDuration: motion.glide,
    animationTimingFunction: motion.easeSettle,
    animationFillMode: 'both',
    transformOrigin: 'center top'
  },
  peekIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    borderRadius: 999,
    backgroundColor: colors.accentSoft,
    color: colors.accent,
    animationName: { default: bob, [media.reducedMotion]: 'none' },
    animationDuration: '1.6s',
    animationTimingFunction: motion.easeInOut,
    animationIterationCount: 'infinite',
    // Let the badge's own pop finish before the icon starts to float.
    animationDelay: motion.glide
  },
  // Second icon of a pair overlaps the first and floats a beat later, so the two read as a stack.
  peekIconStacked: {
    marginLeft: -12,
    boxShadow: `0 0 0 2px ${colors.bg3}`,
    animationDelay: `calc(${motion.glide} + 300ms)`
  },
  peekLabel: { fontSize: text.t12, fontWeight: weight.medium, color: colors.fg1, whiteSpace: 'nowrap' },
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
    backdropFilter: 'blur(24px)',
    boxShadow: `0 0 0 1px ${colors.hairline} inset`,
    cursor: 'grab',
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut,
    outline: 'none'
  },
  // `box-shadow` is left untransitioned on purpose: it is the focus ring here.
  tileFocus: {
    boxShadow: {
      default: `0 0 0 1px ${colors.hairline} inset`,
      ':focus-visible': `0 0 0 2px ${colors.accent}`
    }
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

import * as stylex from '@stylexjs/stylex'
import { colors, fonts, motion, radii, shadows, text, weight } from '../../../styles/tokens.stylex'

const enter = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(8px)' }
})

export const styles = stylex.create({
  card: {
    cursor: 'pointer',
    position: 'absolute',
    top: 0,
    left: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderRadius: radii.r2,
    outline: 'none',
    willChange: 'transform',
    transitionProperty: 'transform, width, opacity',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut,
    contentVisibility: 'auto'
  },
  rect: (x: number, y: number, w: number, h: number) => ({
    transform: `translate(${x}px, ${y}px)`,
    width: w,
    height: h
  }),
  entering: {
    animationName: enter,
    animationDuration: motion.slow,
    animationTimingFunction: motion.easeOut,
    animationFillMode: 'backwards'
  },
  missing: { opacity: 0.6 },
  body: {
    position: 'relative',
    width: '100%',
    borderRadius: radii.r2,
    overflow: 'hidden',
    backgroundColor: colors.bg2,
    transitionProperty: 'box-shadow, transform',
    // `box-shadow` carries the focus ring as well as the hover lift, so it stays fast: a ring that
    // fades in over 260 ms trails behind where focus actually is.
    transitionDuration: `${motion.fast}, ${motion.slow}`,
    transitionTimingFunction: motion.easeOut,
    boxShadow: {
      default: `0 0 0 1px ${colors.hairline} inset`,
      [stylex.when.ancestor(':hover')]: `0 0 0 1px ${colors.hairlineStrong} inset, ${shadows.lift}`,
      [stylex.when.ancestor(':focus-visible')]: `0 0 0 2px ${colors.bg0}, 0 0 0 4px ${colors.accent}`
    }
  },
  bodySelected: {
    boxShadow: {
      default: `0 0 0 2px ${colors.accent} inset`,
      [stylex.when.ancestor(':hover')]: `0 0 0 2px ${colors.accent} inset, ${shadows.lift}`,
      [stylex.when.ancestor(':focus-visible')]:
        `0 0 0 2px ${colors.accent} inset, 0 0 0 2px ${colors.bg0}, 0 0 0 4px ${colors.accent}`
    }
  },
  bodyHeight: (h: number) => ({ height: h }),
  media: { position: 'absolute', inset: 0 },
  paperBody: { backgroundColor: colors.paper },
  check: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 18,
    height: 18,
    borderRadius: '50%',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    color: colors.fgOnAccent,
    boxShadow: shadows.lift
  },
  hover: {
    position: 'absolute',
    top: 8,
    right: 8,
    display: 'flex',
    gap: 4,
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1
    },
    transitionProperty: 'opacity',
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut
  },
  quick: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    borderRadius: radii.r1,
    color: { default: colors.fg2, ':hover': colors.fg1 },
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    boxShadow: shadows.lift,
    opacity: { default: 1, ':disabled': 0.4 }
  },
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    paddingBlock: 2,
    paddingInline: 6,
    borderRadius: 4,
    fontSize: text.t11,
    fontWeight: weight.medium,
    color: colors.onMedia,
    backgroundColor: colors.overlayDark,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '0.01em'
  },
  play: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: colors.onMedia,
    pointerEvents: 'none'
  },
  playGlyph: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    paddingLeft: 2,
    borderRadius: '50%',
    backgroundColor: colors.overlayDark,
    boxShadow: shadows.lift
  },
  favicon: {
    position: 'absolute',
    left: 8,
    bottom: 8,
    width: 20,
    height: 20,
    borderRadius: 5,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlayDark,
    boxShadow: shadows.lift,
    overflow: 'hidden'
  },
  faviconImg: { width: 14, height: 14, borderRadius: 2 },
  faviconLetter: {
    fontSize: text.t11,
    fontWeight: weight.semibold,
    color: colors.onMedia,
    textTransform: 'uppercase',
    lineHeight: 1
  },
  textBody: {
    position: 'absolute',
    inset: 0,
    paddingTop: 16,
    paddingInline: 16,
    paddingBottom: 14,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    overflow: 'hidden'
  },
  excerpt: {
    fontSize: text.t13,
    lineHeight: 1.5,
    color: colors.fg2,
    overflow: 'hidden',
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 7
  },
  linkFallback: {
    fontFamily: fonts.mono,
    fontSize: text.t12,
    color: colors.fg3,
    // Break at the soft points `displayUrl` inserts; `anywhere` is only the last resort.
    overflowWrap: 'anywhere',
    WebkitLineClamp: 3
  },
  noteEyebrow: { color: colors.ink, opacity: 0.5 },
  eyebrowChecked: { paddingLeft: 22 },
  repoDescription: { WebkitLineClamp: 2, lineHeight: 1.45, maxHeight: 38, flexShrink: 0 },
  repoBody: { gap: 6, paddingTop: 14 },
  noteExcerpt: {
    fontFamily: fonts.serif,
    fontSize: 17,
    lineHeight: 1.4,
    color: colors.ink,
    letterSpacing: '-0.005em',
    WebkitLineClamp: 8
  },
  repoTitle: {
    fontSize: text.t15,
    fontWeight: weight.medium,
    color: colors.fg1,
    letterSpacing: '-0.01em',
    overflowWrap: 'anywhere'
  },
  repoMeta: {
    marginTop: 'auto',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    fontSize: text.t12,
    color: colors.fg3,
    fontVariantNumeric: 'tabular-nums'
  },
  repoStat: { display: 'inline-flex', alignItems: 'center', gap: 4 },
  langDot: { width: 8, height: 8, borderRadius: '50%', backgroundColor: colors.fg4 },
  fileTile: {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    color: colors.fg3
  },
  fileGlyph: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 56,
    height: 68,
    borderRadius: radii.r1,
    backgroundColor: colors.bg3,
    boxShadow: `0 0 0 1px ${colors.hairline} inset`,
    color: colors.fg4
  },
  fileExt: {
    fontSize: text.t12,
    fontWeight: weight.medium,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: colors.fg3
  },
  fileSub: { fontSize: text.t12, color: colors.fg4, fontVariantNumeric: 'tabular-nums' },
  fileMissing: {
    fontSize: text.t12,
    color: colors.fg3,
    textTransform: 'none',
    letterSpacing: 0,
    fontWeight: weight.regular
  },
  audioDuration: {
    fontSize: text.t20,
    fontWeight: weight.medium,
    color: colors.fg2,
    fontVariantNumeric: 'tabular-nums',
    letterSpacing: '-0.01em'
  },
  collage: {
    position: 'absolute',
    inset: 0,
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gridTemplateRows: '1fr 1fr',
    gap: 3,
    padding: 3
  },
  collageCell: { borderRadius: 6, overflow: 'hidden', backgroundColor: colors.bg3 },
  caption: { display: 'flex', flexDirection: 'column', gap: 2, paddingInline: 4, minWidth: 0 },
  title: { fontSize: text.t13, fontWeight: weight.medium, color: colors.fg1, letterSpacing: '-0.005em' },
  secondary: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: text.t12,
    color: colors.fg3,
    whiteSpace: 'nowrap',
    overflow: 'hidden'
  },
  retry: {
    color: { default: colors.fg2, ':hover': colors.fg1 },
    textDecorationLine: 'underline',
    textDecorationColor: colors.hairlineStrong,
    textUnderlineOffset: 2,
    flexShrink: 0
  }
})

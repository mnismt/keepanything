import * as stylex from '@stylexjs/stylex'
import { colors, fonts, layout, motion, radii, space, text } from '../../../styles/tokens.stylex'

const rise = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(6px)' } })

export const styles = stylex.create({
  empty: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: space.s12,
    paddingInline: layout.contentPad,
    paddingBottom: '18vh',
    textAlign: 'center',
    minHeight: 0,
    animationName: rise,
    animationDuration: motion.slow,
    animationTimingFunction: motion.easeOut
  },
  hero: {
    fontFamily: fonts.serif,
    fontSize: text.hero,
    lineHeight: 1.08,
    letterSpacing: '-0.015em',
    color: colors.fg1,
    maxWidth: 560,
    fontWeight: 400
  },
  heroRest: { fontStyle: 'italic', color: colors.fg2 },
  hint: {
    marginTop: space.s6,
    color: colors.fg3,
    fontSize: text.t13,
    display: 'flex',
    alignItems: 'center',
    gap: space.s3
  },
  sep: { width: 3, height: 3, borderRadius: '50%', backgroundColor: colors.fg4 },
  quiet: { fontSize: text.t15, color: colors.fg2 },
  quietSub: { marginTop: space.s2, color: colors.fg4, fontSize: text.t13, maxWidth: 380, lineHeight: 1.5 },
  aiHint: {
    marginTop: space.s10,
    display: 'inline-flex',
    alignItems: 'center',
    gap: space.s2,
    height: 28,
    paddingInline: space.s3,
    borderRadius: radii.r1,
    fontSize: text.t12,
    color: { default: colors.fg3, ':hover': colors.fg1 },
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    transitionProperty: 'color, background-color',
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut
  },
  aiDot: { width: 6, height: 6, borderRadius: '50%', backgroundColor: colors.fg4 },
  aiDotOffline: { backgroundColor: colors.danger },
  linkButton: {
    color: { default: colors.fg3, ':hover': colors.fg1 },
    textDecorationLine: 'underline',
    textDecorationColor: colors.hairlineStrong,
    textUnderlineOffset: 2
  }
})

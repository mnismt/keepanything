import * as stylex from '@stylexjs/stylex'
import { colors, motion, radii, space, text, weight, zIndex } from '../../../styles/tokens.stylex'

const fade = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } })

export const styles = stylex.create({
  overlay: {
    position: 'absolute',
    inset: 0,
    zIndex: zIndex.drop,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.scrim,
    animationName: fade,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut
  },
  ring: {
    position: 'absolute',
    inset: space.s4,
    borderWidth: 2,
    borderStyle: 'solid',
    borderColor: colors.accent,
    borderRadius: radii.r3,
    pointerEvents: 'none'
  },
  hint: { textAlign: 'center', color: colors.fg1 },
  hintTitle: { fontSize: text.t20, fontWeight: weight.medium, letterSpacing: '-0.01em' },
  hintSub: { marginTop: space.s1, color: colors.fg2 }
})

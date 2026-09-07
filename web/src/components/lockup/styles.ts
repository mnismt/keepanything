import * as stylex from '@stylexjs/stylex'
import { colors, motion, radii, space, text } from '../../styles/tokens.stylex'

const MOBILE = '@media (max-width: 800px)'
const REDUCED = '@media (prefers-reduced-motion: reduce)'

// Wipes the lockup in left to right. `inset()` clips from the right edge inward, so 100% -> 0
// uncovers the MiniMax mark first and lands on GMI.
const wipe = stylex.keyframes({
  from: { clipPath: 'inset(0 100% 0 0)' },
  to: { clipPath: 'inset(0 0 0 0)' }
})

const fade = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 }
})

export const styles = stylex.create({
  svg: {
    // 286:38 intrinsic; height drives the width.
    height: 15,
    width: 'auto',
    display: 'block',
    flexShrink: 0
  },
  plate: {
    animationName: wipe,
    animationDuration: { default: '820ms', [REDUCED]: '0ms' },
    animationDelay: { default: '320ms', [REDUCED]: '0ms' },
    // easeSettle front-loads too hard here: the wipe has to read as travel, not as a pop.
    animationTimingFunction: motion.easeInOut,
    animationFillMode: 'both',
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    columnGap: space.s3,
    paddingInline: space.s3,
    paddingBlock: space.s2,
    borderRadius: radii.r2,
    // Dark in both themes, so the white wordmarks stay legible on the cream background.
    backgroundColor: colors.overlayDark,
    fontSize: text.t11,
    color: colors.onMedia
  },
  label: {
    animationName: fade,
    animationDuration: motion.glide,
    animationDelay: { default: '900ms', [REDUCED]: '0ms' },
    animationTimingFunction: motion.easeOut,
    animationFillMode: 'both',
    display: { default: 'inline', [MOBILE]: 'none' },
    fontSize: text.t12,
    color: colors.fg4
  },
  cross: {
    animationName: fade,
    animationDuration: motion.glide,
    animationDelay: { default: '140ms', [REDUCED]: '0ms' },
    animationTimingFunction: motion.easeOut,
    animationFillMode: 'both',
    fontSize: text.t13,
    color: colors.fg4
  },
  group: {
    display: { default: 'inline-flex', [MOBILE]: 'contents' },
    alignItems: 'center',
    columnGap: space.s3
  }
})

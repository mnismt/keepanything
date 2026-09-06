import * as stylex from '@stylexjs/stylex'
import { colors, fonts, text, weight } from '../../styles/tokens.stylex'

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
  root: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '8px',
    color: colors.fg1
  },
  mark: {
    width: 24,
    height: 24,
    flexShrink: 0
  },
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
  dropC: { transform: 'translateY(0) rotate(6deg)', animationDelay: '8000ms' }
})

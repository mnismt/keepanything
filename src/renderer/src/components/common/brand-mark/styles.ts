import * as stylex from '@stylexjs/stylex'

const REDUCED = '@media (prefers-reduced-motion: reduce)'

/** One full pass of all three shapes; the stagger below splits it into equal thirds. */
export const CYCLE_MS = 12_000

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
  mark: (size: number) => ({ width: size, height: size, flexShrink: 0 }),
  drop: {
    transformBox: 'fill-box',
    transformOrigin: 'center',
    animationName: { default: drop, [REDUCED]: 'none' },
    animationDuration: `${CYCLE_MS}ms`,
    animationTimingFunction: 'linear',
    animationIterationCount: 'infinite'
  },
  // The delay is the shape's slot in the cycle minus the page-timeline phase, so a mark mounted
  // later in the session falls in step with the one mounted at launch instead of restarting.
  phase: (slotMs: number, phaseMs: number) => ({ animationDelay: `${slotMs + phaseMs}ms` }),
  restA: { transform: 'translateY(0) rotate(-10deg)' },
  restB: { transform: 'translateY(0) rotate(0deg)' },
  restC: { transform: 'translateY(0) rotate(6deg)' }
})

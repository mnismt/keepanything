import { motion } from 'motion/react'
import { EASE_APPLE, STROKE_ROOT } from '../shared'
import type { AnimatedSidebarIconProps } from '../types'

/**
 * Lucide `inbox`, paths verbatim.
 *
 *   - `BODY`  — the tray outline: sides, top fold, and the inner V that catches what falls in.
 *   - `LIP`   — the small inner chevron that traces the V's lip, which is what moves on hover.
 */
const BODY =
  'M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z'
const LIP = '22 12 16 12 14 15 10 15 8 12 2 12'

/**
 * The inbox lip settles on hover — a small drop, held in two targets so an interrupted hover
 * reverses from wherever it is rather than from the start.
 *
 * `DROP` is 2 units in the 24-unit viewBox: ~1.2px at the rendered size, the device-pixel floor
 * the portfolio skill names as the lower bound for a visible gesture.
 */
const DROP = 2

export function InboxIcon({ active, reducedMotion, className }: AnimatedSidebarIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...STROKE_ROOT}>
      <path d={BODY} />
      {reducedMotion ? (
        <polyline points={LIP} />
      ) : (
        <motion.polyline
          points={LIP}
          initial={false}
          transition={{
            duration: reducedMotion ? 0.014 : 0.42,
            ease: EASE_APPLE
          }}
        />
      )}
    </svg>
  )
}

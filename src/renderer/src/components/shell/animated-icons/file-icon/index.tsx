import { motion } from 'motion/react'
import { EASE_APPLE, RELEASE, STROKE_ROOT } from '../shared'
import type { AnimatedSidebarIconProps } from '../types'

/**
 * Lucide `file`, paths verbatim. The main outline draws the page; the short path is the dog-ear
 * fold line that traces from the inner hinge up to the corner and across to the outer edge.
 */
const BODY =
  'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z'
const FOLD = 'M14 2v5a1 1 0 0 0 1 1h5'

/**
 * The corner fold lifts on hover — held in two targets so an interrupted hover reverses from
 * wherever it is rather than from the start.
 *
 * The path's bbox runs from (14, 2) to (20, 8); the hinge sits at the bottom-left of that box
 * (x = 14, y = 8), which under motion's default `fill-box` is `originX: 0`, `originY: 1`. The
 * scale foreshortens the fold toward the hinge: `0.88` reads as the corner tipping further into
 * a dog-ear.
 */
const TILT = 0.88

export function FileIcon({ active, reducedMotion, className }: AnimatedSidebarIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...STROKE_ROOT}>
      <path d={BODY} />
      {reducedMotion ? (
        <path d={FOLD} />
      ) : (
        <motion.path
          d={FOLD}
          style={{ originX: 0, originY: 1 }}
          initial={false}
          animate={{ scale: active ? TILT : 1 }}
          transition={active ? { duration: 0.42, ease: EASE_APPLE } : RELEASE}
        />
      )}
    </svg>
  )
}

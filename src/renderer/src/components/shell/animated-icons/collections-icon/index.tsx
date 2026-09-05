import { motion } from 'motion/react'
import { EASE_APPLE, RELEASE, STROKE_ROOT } from '../shared'
import type { AnimatedSidebarIconProps } from '../types'

/**
 * Lucide `layers`, paths verbatim. Three diamond-stacked planes; nothing in the resting mark
 * moves. The bottom layer stays anchored on hover so the spread reads as the stack fanning
 * apart rather than the whole icon drifting.
 */
const LAYERS = [
  'M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z',
  'M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12',
  'M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17'
]

/**
 * Two upper layers lift, the bottom stays. Each tier staggered so the spread reads as a
 * cascade rather than a block shift.
 */
const LIFT = -1.6
const STAGGER = 0.06

export function CollectionsIcon({ active, reducedMotion, className }: AnimatedSidebarIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...STROKE_ROOT}>
      {LAYERS.map((d, i) =>
        reducedMotion ? (
          <path key={d} d={d} />
        ) : (
          <motion.path
            // eslint-disable-next-line react/no-array-index-key
            key={d}
            d={d}
            initial={false}
            // index 0 = bottom (anchored); index 1, 2 = mid, top (lifted).
            animate={{ y: active && i > 0 ? LIFT : 0 }}
            transition={active ? { duration: 0.42, ease: EASE_APPLE, delay: i * STAGGER } : RELEASE}
          />
        )
      )}
    </svg>
  )
}

import { motion } from 'motion/react'
import { EASE_APPLE, RELEASE, STROKE_ROOT } from '../shared'
import type { AnimatedSidebarIconProps } from '../types'

/**
 * Lucide `link`, paths verbatim. Two open chain halves angled into each other; nothing in the
 * resting mark moves.
 */
const LEFT = 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'
const RIGHT = 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'

/**
 * The chain halves drift toward each other on hover - a held state in two targets, so an
 * interrupted hover reverses from wherever it is rather than from the start.
 *
 * `CLOSE` is 1.5 units in the 24-unit viewBox: ~0.9px at the rendered size, the device-pixel
 * floor the portfolio skill names as the lower bound for a visible gesture.
 */
const CLOSE = 1.5

export function LinksIcon({ active, reducedMotion, className }: AnimatedSidebarIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...STROKE_ROOT}>
      {reducedMotion ? (
        <>
          <path d={LEFT} />
          <path d={RIGHT} />
        </>
      ) : (
        <>
          <motion.path
            d={LEFT}
            initial={false}
            animate={{ x: active ? CLOSE : 0 }}
            transition={active ? { duration: 0.42, ease: EASE_APPLE } : RELEASE}
          />
          <motion.path
            d={RIGHT}
            initial={false}
            animate={{ x: active ? -CLOSE : 0 }}
            transition={active ? { duration: 0.42, ease: EASE_APPLE } : RELEASE}
          />
        </>
      )}
    </svg>
  )
}

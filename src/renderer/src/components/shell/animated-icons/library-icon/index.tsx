import { motion } from 'motion/react'
import { EASE_APPLE, RELEASE, STROKE_ROOT } from '../shared'
import type { AnimatedSidebarIconProps } from '../types'

/**
 * Lucide `library`, paths verbatim. Four vertical lines of different heights read as books on a
 * shelf; nothing in the resting mark moves.
 */
const SPINES = ['m16 6 4 14', 'M12 6v14', 'M8 8v12', 'M4 4v16']

const STAGGER = 0.05

/**
 * A held state: books lift off the shelf on hover and settle back on leave.
 *
 * The vertical translate is held in two targets (`lifted` vs rest) so an interrupted hover
 * - pointer leaves mid-rise, then returns - re-aims the spring cleanly with the velocity
 * intact. Stagger across the four spines so they cascade in reading order rather than all
 * rising as a block.
 *
 * Magnitudes are chosen against the 24-unit viewBox: `LIFT` is 1.6 units - about 1px at the
 * 14px the icon renders at, which is at the device-pixel floor the portfolio skill names.
 */
const LIFT = -1.6

const lift = (delay: number, reducedMotion: boolean) => ({
  duration: reducedMotion ? 0.014 : 0.42,
  ease: EASE_APPLE,
  delay: reducedMotion ? 0 : delay
})

export function LibraryIcon({ active, reducedMotion, className }: AnimatedSidebarIconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...STROKE_ROOT}>
      {SPINES.map((d, i) =>
        reducedMotion ? (
          <path key={d} d={d} />
        ) : (
          <motion.path
            // eslint-disable-next-line react/no-array-index-key
            key={d}
            d={d}
            initial={false}
            animate={{ y: active ? LIFT : 0 }}
            transition={active ? lift(i * STAGGER, false) : RELEASE}
          />
        )
      )}
    </svg>
  )
}

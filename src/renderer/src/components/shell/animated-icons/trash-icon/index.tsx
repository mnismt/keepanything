import { motion } from 'motion/react'
import { EASE_APPLE, RELEASE, STROKE_ROOT } from '../shared'
import type { AnimatedSidebarIconProps } from '../types'

/**
 * Lucide `trash-2`, paths verbatim. Body and interior vertical lines stay anchored on hover;
 * the lid (a horizontal line at y=6) and the handle (the inverted-U above it) lift together so
 * the open-bin gesture reads as one piece of hardware moving.
 */
const BODY = 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'
const LINES = ['M10 11v6', 'M14 11v6']
const LID = 'M3 6h18'
const HANDLE = 'M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'

/**
 * The lid-and-handle pair lifts together as one held target. Two values (lifted vs rest),
 * so an interrupted hover reverses from wherever it is rather than from the start.
 *
 * `LIFT` is 1.5 units in the 24-unit viewBox: ~0.9px at the rendered size, the device-pixel
 * floor the portfolio skill names as the lower bound for a visible gesture.
 */
const LIFT = -1.5

export function TrashIcon({ active, reducedMotion, className }: AnimatedSidebarIconProps) {
  const lidTransition = active ? { duration: 0.42, ease: EASE_APPLE } : RELEASE

  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} {...STROKE_ROOT}>
      <path d={BODY} />
      {LINES.map((d) => (
        <path key={d} d={d} />
      ))}
      {reducedMotion ? (
        <>
          <path d={LID} />
          <path d={HANDLE} />
        </>
      ) : (
        <>
          <motion.path d={LID} initial={false} animate={{ y: active ? LIFT : 0 }} transition={lidTransition} />
          <motion.path d={HANDLE} initial={false} animate={{ y: active ? LIFT : 0 }} transition={lidTransition} />
        </>
      )}
    </svg>
  )
}

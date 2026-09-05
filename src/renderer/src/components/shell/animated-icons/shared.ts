/**
 * The things every sidebar icon agrees on.
 *
 * Folder-local module rather than a per-file constant: there are six icons sitting one above the
 * other in the same column, and a stroke vocabulary that drifts between them is visible in a way
 * the easing never is.
 *
 * Durations here are JS-side numbers (seconds) so motion's transition can use them directly. They
 * deliberately stay inside the StyleX `motion.*` token band (`motion.fast` 120ms, `motion.base`
 * 180ms, `motion.slow` 260ms) so the icon at rest feels of a piece with the rest of the shell -
 * see `src/renderer/src/styles/tokens.stylex.ts`.
 */

/**
 * `cubic-bezier(0.16, 1, 0.3, 1)` - Apple's settled ease. Reaches its target with a clear
 * arrival rather than easing in and out symmetrically. Matches the feel of the StyleX `ease`
 * token used elsewhere in the shell.
 */
export const EASE_APPLE = [0.16, 1, 0.3, 1] as const

/**
 * Letting go. Every gesture here plays once on hover-enter and settles on hover-leave, so every
 * mark needs a way back to the resting icon - and they share a single duration so that sliding
 * off the sidebar feels like one thing settling rather than six things stopping.
 *
 * Faster than any of the gestures on purpose. A release that takes as long as the performance
 * reads as the animation continuing without you, which is the opposite of what leaving means.
 */
export const RELEASE = { duration: 0.32, ease: EASE_APPLE } as const

/**
 * The hover-in performance duration. Matches the StyleX `motion.slow` token (260ms) and sits
 * inside the StyleX ease envelope. Reduced motion collapses every duration to `0.014s` per icon.
 */
export const PERFORM = { duration: 0.42, ease: EASE_APPLE } as const

/**
 * Stroke vocabulary for the icons. SVG presentation attributes inherit, so children carry only
 * a `d`; anything that needs a fill overrides it locally.
 *
 * Mirrors the portfolio's `STROKE_ROOT` so the marks read the same on both surfaces.
 */
export const STROKE_ROOT = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

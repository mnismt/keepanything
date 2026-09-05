import type { ComponentType } from 'react'

/**
 * Props every animated sidebar icon accepts.
 *
 * The row owns both flags and passes them down, so each icon is a pure function of its props. CSS
 * `:hover` still owns colour and opacity shifts on the parent link; the icon answers `active`
 * with its gesture and `reducedMotion` with the static Lucide mark.
 */
export type AnimatedSidebarIconProps = {
  /**
   * True while the sidebar row is pointed at or keyboard-focused.
   * The gesture is an answer to the pointer, which is what makes a column of six of them
   * readable — one performs, the others stay marks.
   */
  active: boolean
  /**
   * Under reduced motion the icon renders as the plain static Lucide mark and `active` does
   * nothing. Every gesture here is a round trip with no end state worth holding.
   */
  reducedMotion: boolean
  className?: string
}

export type AnimatedSidebarIcon = ComponentType<AnimatedSidebarIconProps>

/**
 * Small style atoms shared across components (StyleX). Anything larger belongs next to its
 * component.
 */
import * as stylex from '@stylexjs/stylex'
import { colors, motion, text } from './tokens.stylex'

export const shared = stylex.create({
  srOnly: {
    position: 'absolute',
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: 'hidden',
    clip: 'rect(0, 0, 0, 0)',
    whiteSpace: 'nowrap',
    borderWidth: 0
  },
  tnum: {
    fontVariantNumeric: 'tabular-nums'
  },
  /** Section label: 11 px uppercase tracked. */
  eyebrow: {
    fontSize: text.t11,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: colors.fg4
  },
  ellipsis: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap'
  },
  selectable: {
    userSelect: 'text',
    WebkitUserSelect: 'text'
  },
  /** Window drag region (macOS hidden title bar). */
  drag: {
    WebkitAppRegion: 'drag'
  },
  noDrag: {
    WebkitAppRegion: 'no-drag'
  },
  /**
   * Hover tint for controls and repeated rows. Compose it before the component's own style so a
   * component can still override the duration. Deliberately excludes `box-shadow`: focus rings are
   * drawn with it and must appear the instant focus moves.
   */
  hoverFade: {
    transitionProperty: 'color, background-color',
    transitionDuration: motion.base,
    transitionTimingFunction: motion.easeOut
  }
})

import Scritto from '@scritto/react'
import type * as stylex from '@stylexjs/stylex'
import { props as stylexProps } from '@stylexjs/stylex'
import { useEffect, useState } from 'react'

export interface RevealTextProps {
  text: string
  /** Sweep the glyphs in from empty on mount. Later changes always roll. */
  reveal?: boolean
  /** Milliseconds to hold empty before the sweep starts, for staggering a list. */
  delayMs?: number
  /** Transition length in ms; Scritto's default otherwise. */
  durationMs?: number
  /** Direction hint for the roll: 1 counts up, -1 counts down, 0 crossfades. */
  trend?: -1 | 0 | 1
  style?: stylex.StyleXStyles | ReadonlyArray<stylex.StyleXStyles | false | null | undefined>
}

/**
 * Scritto's React wrapper never animates the first value it is given, so a reveal renders empty
 * for one frame and then rolls to the real text.
 */
export function RevealText({
  text,
  reveal = false,
  delayMs = 0,
  durationMs,
  trend = 0,
  style
}: RevealTextProps): React.JSX.Element {
  const [shown, setShown] = useState(reveal ? '' : text)
  useEffect(() => {
    if (!reveal) {
      setShown(text)
      return
    }
    const id = window.setTimeout(() => setShown(text), delayMs)
    return () => window.clearTimeout(id)
  }, [text, reveal, delayMs])
  const styleProps = style ? stylexProps(...(Array.isArray(style) ? style : [style])) : {}
  return (
    <Scritto
      {...styleProps}
      value={shown}
      trend={trend}
      edgeFade="never"
      {...(durationMs ? { transition: { duration: durationMs } } : {})}
    />
  )
}

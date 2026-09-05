import type { StyleXStyles } from '@stylexjs/stylex'
import * as stylex from '@stylexjs/stylex'
import { useState } from 'react'
import { styles } from './styles'

export interface ThumbProps {
  src: string | null
  alt?: string
  /** Fill while the image loads (item `dominantColor`). */
  fill?: string | null
  fit?: 'cover' | 'contain'
  style?: StyleXStyles
}

/** Lazy, non-draggable thumbnail that fades in over its dominant colour. */
export function Thumb({ src, alt = '', fill, fit = 'cover', style }: ThumbProps): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  return (
    <span {...stylex.props(styles.thumb, fill ? styles.fill(fill) : null, style)}>
      {src ? (
        <img
          {...stylex.props(styles.img, loaded && styles.loaded, fit === 'contain' && styles.contain)}
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(true)}
        />
      ) : null}
    </span>
  )
}

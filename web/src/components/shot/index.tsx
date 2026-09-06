import * as stylex from '@stylexjs/stylex'
import { styles } from './styles'

type Props = {
  alt: string
  ratio: string
  src?: string
  caption?: string
  shadow?: 'sheet' | 'pop'
}

// Without `src` it renders a labelled frame. Drop a PNG into public/shots/ and pass `src="/shots/<name>.png"`.
// The caption sits on a dark plate so it stays legible over whatever screenshot lands underneath it.
export function Shot({ alt, ratio, src, caption, shadow = 'pop' }: Props) {
  return (
    <figure {...stylex.props(styles.frame, styles.ratio(ratio), shadow === 'sheet' ? styles.sheet : styles.pop)}>
      {src ? (
        <img src={src} alt={alt} {...stylex.props(styles.img)} />
      ) : (
        <span {...stylex.props(styles.label)}>{alt}</span>
      )}
      {caption ? <figcaption {...stylex.props(styles.caption)}>{caption}</figcaption> : null}
    </figure>
  )
}

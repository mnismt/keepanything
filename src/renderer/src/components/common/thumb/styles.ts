import * as stylex from '@stylexjs/stylex'
import { colors, motion } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  thumb: {
    position: 'relative',
    display: 'block',
    width: '100%',
    height: '100%',
    overflow: 'hidden',
    backgroundColor: colors.bg2,
    borderRadius: 'inherit'
  },
  fill: (color: string) => ({ backgroundColor: color }),
  img: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    opacity: 0,
    transitionProperty: 'opacity',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut
  },
  loaded: { opacity: 1 },
  contain: { objectFit: 'contain' }
})

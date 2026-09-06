import * as stylex from '@stylexjs/stylex'
import { space, zIndex } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  stack: {
    position: 'fixed',
    right: space.s5,
    bottom: space.s5,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: space.s2,
    zIndex: zIndex.status,
    pointerEvents: 'none'
  }
})

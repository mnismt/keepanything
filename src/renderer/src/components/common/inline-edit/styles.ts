import * as stylex from '@stylexjs/stylex'
import { colors, motion, radii } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  text: {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    borderRadius: radii.r1,
    marginInline: -6,
    paddingInline: 6,
    paddingBlock: 2,
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    transitionProperty: 'background-color',
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut,
    cursor: 'text',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere'
  },
  placeholder: { color: colors.fg4 },
  field: {
    display: 'block',
    width: '100%',
    marginInline: -6,
    paddingInline: 6,
    paddingBlock: 2,
    borderRadius: radii.r1,
    backgroundColor: colors.bg2,
    backdropFilter: 'blur(24px)',
    boxShadow: `0 0 0 1px ${colors.accent}`,
    outline: { default: 'none', ':focus-visible': 'none' },
    resize: 'none',
    lineHeight: 'inherit',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    letterSpacing: 'inherit',
    color: 'inherit',
    userSelect: 'text',
    WebkitUserSelect: 'text'
  }
})

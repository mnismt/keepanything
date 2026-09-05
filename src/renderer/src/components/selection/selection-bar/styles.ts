import * as stylex from '@stylexjs/stylex'
import { colors, layout, motion, radii, shadows, space, text, weight, zIndex } from '../../../styles/tokens.stylex'

const rise = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(12px)' },
  to: { opacity: 1, transform: 'none' }
})

const pop = stylex.keyframes({ from: { opacity: 0, transform: 'translateY(4px)' } })

export const styles = stylex.create({
  wrap: {
    position: 'absolute',
    left: layout.contentPad,
    bottom: space.s6,
    maxWidth: 'calc(100% - 340px)',
    zIndex: zIndex.selection,
    animationName: rise,
    animationDuration: motion.base,
    animationTimingFunction: motion.easeOut
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 2,
    paddingTop: 6,
    paddingBottom: 6,
    paddingRight: 6,
    paddingLeft: 14,
    borderRadius: radii.r2,
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    boxShadow: shadows.pop,
    whiteSpace: 'nowrap'
  },
  count: { fontWeight: weight.medium, marginRight: space.s3, fontVariantNumeric: 'tabular-nums' },
  sep: { width: 1, height: 16, backgroundColor: colors.hairlineStrong, marginInline: space.s1 },
  popover: {
    position: 'absolute',
    left: 0,
    bottom: 'calc(100% + 8px)',
    width: 300,
    maxHeight: 320,
    display: 'flex',
    flexDirection: 'column',
    borderRadius: radii.r2,
    backgroundColor: colors.bg3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline,
    boxShadow: shadows.pop,
    overflow: 'hidden',
    animationName: pop,
    animationDuration: motion.fast,
    animationTimingFunction: motion.easeOut
  },
  popList: { overflowY: 'auto', paddingTop: space.s1, paddingInline: space.s1, paddingBottom: space.s1 },
  popHead: { paddingTop: space.s2, paddingInline: space.s3, paddingBottom: space.s1 },
  popItem: {
    display: 'grid',
    gridTemplateColumns: '16px 1fr auto',
    alignItems: 'center',
    gap: space.s2,
    width: '100%',
    height: 32,
    paddingInline: space.s2,
    borderRadius: radii.r1,
    textAlign: 'left',
    color: colors.fg1,
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover, ':focus-visible': colors.bgHover }
  },
  popIcon: { display: 'inline-flex', color: colors.fg3 },
  popMeta: { fontSize: text.t11, color: colors.fg4, fontVariantNumeric: 'tabular-nums' },
  popEmpty: { paddingBlock: space.s3, paddingInline: space.s3, fontSize: text.t12, color: colors.fg4 },
  popNew: {
    display: 'flex',
    alignItems: 'center',
    gap: space.s2,
    paddingBlock: space.s2,
    paddingInline: space.s2,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.hairline
  },
  popInput: {
    flexGrow: 1,
    height: 28,
    paddingInline: space.s2,
    borderRadius: radii.r1,
    backgroundColor: colors.bg2,
    color: colors.fg1,
    fontSize: text.t13,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: { default: colors.hairline, ':focus-visible': colors.accent },
    outline: { default: 'none', ':focus-visible': 'none' },
    '::placeholder': { color: colors.fg4 }
  }
})

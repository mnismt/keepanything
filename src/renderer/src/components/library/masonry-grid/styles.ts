import * as stylex from '@stylexjs/stylex'
import { colors, layout as layoutTokens, motion, radii, space, text, weight } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  scroller: {
    position: 'relative',
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    paddingTop: space.s2,
    paddingInline: layoutTokens.contentPad,
    paddingBottom: space.s12,
    outline: 'none'
  },
  inner: { width: '100%' },
  canvas: {
    position: 'relative',
    width: '100%',
    transitionProperty: 'height',
    transitionDuration: motion.slow,
    transitionTimingFunction: motion.easeOut
  },
  canvasHeight: (h: number) => ({ height: h }),
  list: { display: 'flex', flexDirection: 'column' },
  row: {
    display: 'grid',
    gridTemplateColumns: '44px 1fr auto',
    alignItems: 'center',
    gap: space.s3,
    height: 52,
    paddingInline: space.s2,
    borderRadius: radii.r1,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: colors.hairline,
    outline: 'none',
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    boxShadow: { default: 'none', ':focus-visible': `inset 0 0 0 2px ${colors.accent}` }
  },
  rowSelected: { backgroundColor: { default: colors.accentSoft, ':hover': colors.accentSoft } },
  rowThumb: { width: 44, height: 36, borderRadius: 4, overflow: 'hidden' },
  rowText: { minWidth: 0, display: 'flex', flexDirection: 'column' },
  rowTitle: { fontWeight: weight.medium },
  rowSecondary: { fontSize: text.t12, color: colors.fg3 },
  rowMeta: { fontSize: text.t12, color: colors.fg4, whiteSpace: 'nowrap' }
})

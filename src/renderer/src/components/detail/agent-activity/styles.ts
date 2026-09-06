import * as stylex from '@stylexjs/stylex'
import { colors, motion, radii, space, text } from '../../../styles/tokens.stylex'

const enter = stylex.keyframes({
  from: { opacity: 0, transform: 'translateY(3px)' },
  to: { opacity: 1, transform: 'translateY(0)' }
})

export const styles = stylex.create({
  list: { display: 'flex', flexDirection: 'column', gap: 2 },
  entry: {
    display: 'grid',
    gridTemplateColumns: '14px 1fr',
    columnGap: space.s2,
    paddingBlock: 6,
    paddingInline: 4,
    marginInline: -4,
    borderRadius: radii.r1,
    textAlign: 'left',
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover },
    transitionProperty: 'background-color',
    transitionDuration: motion.fast,
    transitionTimingFunction: motion.easeOut
  },
  rail: { display: 'flex', justifyContent: 'center', paddingTop: 6 },
  body: { display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 },
  head: { display: 'flex', alignItems: 'baseline', gap: space.s2, minWidth: 0 },
  headRow: { display: 'flex', alignItems: 'baseline', gap: space.s2, minWidth: 0 },
  title: { color: colors.fg1 },
  undo: {
    fontSize: text.t12,
    color: { default: colors.fg3, ':hover': colors.fg1 },
    whiteSpace: 'nowrap',
    borderRadius: 4,
    paddingInline: 4,
    flexShrink: 0
  },
  proposals: { marginTop: space.s2 },
  when: {
    fontSize: text.t12,
    color: colors.fg4,
    marginLeft: 'auto',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums'
  },
  outcome: { fontSize: text.t12, color: colors.fg3, lineHeight: 1.5 },
  steps: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginTop: space.s2,
    paddingLeft: space.s2,
    borderLeftWidth: 1,
    borderLeftStyle: 'solid',
    borderLeftColor: colors.hairline
  },
  step: { display: 'flex', alignItems: 'baseline', gap: space.s2, fontSize: text.t12, color: colors.fg2 },
  stepEnter: (delayMs: number) => ({
    animationName: enter,
    animationDuration: motion.slow,
    animationTimingFunction: motion.easeSettle,
    animationDelay: `${delayMs}ms`,
    animationFillMode: 'both'
  }),
  outcomeEnter: {
    animationName: enter,
    animationDuration: motion.slow,
    animationTimingFunction: motion.easeSettle,
    animationFillMode: 'both'
  },
  stepTool: { color: colors.fg4, minWidth: 64, flexShrink: 0 },
  stepLabel: { flexGrow: 1, minWidth: 0 },
  stepRejected: { color: colors.fg4, textDecorationLine: 'line-through' },
  stepTime: { color: colors.fg4, fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  answer: { marginTop: space.s2, fontSize: text.t13, color: colors.fg2, lineHeight: 1.55 },
  sources: { display: 'flex', flexDirection: 'column', gap: 2, marginTop: space.s1 },
  source: {
    display: 'grid',
    gridTemplateColumns: '24px 1fr',
    gap: space.s2,
    alignItems: 'center',
    paddingBlock: 2,
    paddingInline: 4,
    marginInline: -4,
    borderRadius: radii.r1,
    textAlign: 'left',
    fontSize: text.t12,
    color: colors.fg2,
    backgroundColor: { default: 'transparent', ':hover': colors.bgHover }
  },
  sourceThumb: { width: 24, height: 18, borderRadius: 3, overflow: 'hidden' },
  itemLine: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    fontSize: text.t12,
    color: { default: colors.fg3, ':hover': colors.fg1 },
    textAlign: 'left'
  },
  empty: { fontSize: text.t12, color: colors.fg4 }
})

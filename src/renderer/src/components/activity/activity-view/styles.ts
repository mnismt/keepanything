import * as stylex from '@stylexjs/stylex'
import { colors, space, text } from '../../../styles/tokens.stylex'

export const styles = stylex.create({
  view: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
    overflowY: 'auto',
    flexDirection: 'column',
    gap: space.s6,
    paddingBlock: space.s6,
    paddingInline: space.s8
  },
  section: { display: 'flex', flexDirection: 'column', gap: space.s2, maxWidth: 640 },
  job: { display: 'flex', alignItems: 'center', gap: space.s2, minWidth: 0, fontSize: text.t13, paddingBlock: 4 },
  jobTitle: { flexGrow: 1, minWidth: 0, color: colors.fg1 },
  jobStage: { color: colors.fg3, fontSize: text.t12, whiteSpace: 'nowrap' },
  action: {
    fontSize: text.t12,
    color: { default: colors.fg3, ':hover': colors.fg1 },
    whiteSpace: 'nowrap',
    borderRadius: 4,
    paddingInline: 4
  }
})

/**
 * Explicit theme overrides for the Settings `theme` value. `system` applies neither and the
 * tokens follow `prefers-color-scheme`. Applied on the App root with `stylex.props(theme)`.
 */
import * as stylex from '@stylexjs/stylex'
import type { Theme } from '../../../shared/types'
import { colors, shadows } from './tokens.stylex'

export const lightColors = stylex.createTheme(colors, {
  bg0: '#f7f4ee',
  bg1: '#f0ece4',
  bg2: 'rgba(235, 230, 221, 0.6)',
  bg3: 'rgba(255, 255, 255, 0.7)',
  glass: 'rgba(247, 244, 238, 0.78)',
  glassSide: 'rgba(20, 18, 16, 0.03)',
  bgHover: 'rgba(20, 18, 16, 0.04)',
  bgActive: 'rgba(20, 18, 16, 0.08)',
  scrim: 'rgba(60, 54, 48, 0.4)',
  overlayDark: 'rgba(20, 18, 16, 0.72)',
  fg1: '#1d1a17',
  fg2: 'rgba(29, 26, 23, 0.66)',
  fg3: 'rgba(29, 26, 23, 0.48)',
  fg4: 'rgba(29, 26, 23, 0.3)',
  fgOnAccent: '#1d1a17',
  hairline: 'rgba(20, 18, 16, 0.08)',
  hairlineStrong: 'rgba(20, 18, 16, 0.14)',
  accent: 'var(--ka-accent, #b8813a)',
  accentSoft: 'rgba(184, 129, 58, 0.16)',
  danger: '#b5493a',
  ok: '#4f7f4a',
  paper: '#ece7dd',
  ink: '#1d1a17',
  onMedia: '#efe9e1'
})

export const lightShadows = stylex.createTheme(shadows, {
  sheet: '0 24px 64px rgba(40, 32, 24, 0.22)',
  pop: '0 8px 24px rgba(40, 32, 24, 0.16)',
  lift: '0 2px 8px rgba(40, 32, 24, 0.12)'
})

export const darkColors = stylex.createTheme(colors, {
  bg0: '#141210',
  bg1: '#1a1816',
  bg2: 'rgba(44, 40, 36, 0.6)',
  bg3: 'rgba(58, 52, 47, 0.65)',
  glass: 'rgba(20, 18, 16, 0.42)',
  glassSide: 'rgba(255, 255, 255, 0.03)',
  bgHover: 'rgba(255, 255, 255, 0.04)',
  bgActive: 'rgba(255, 255, 255, 0.07)',
  scrim: 'rgba(10, 9, 8, 0.6)',
  overlayDark: 'rgba(20, 18, 16, 0.72)',
  fg1: '#efe9e1',
  fg2: 'rgba(239, 233, 225, 0.64)',
  fg3: 'rgba(239, 233, 225, 0.48)',
  fg4: 'rgba(239, 233, 225, 0.3)',
  fgOnAccent: '#141210',
  hairline: 'rgba(255, 255, 255, 0.07)',
  hairlineStrong: 'rgba(255, 255, 255, 0.12)',
  accent: 'var(--ka-accent, #d9a35a)',
  accentSoft: 'rgba(217, 163, 90, 0.16)',
  danger: '#d9705a',
  ok: '#8fb98a',
  paper: '#ece7dd',
  ink: '#1d1a17',
  onMedia: '#efe9e1'
})

export const darkShadows = stylex.createTheme(shadows, {
  sheet: '0 24px 64px rgba(0, 0, 0, 0.45)',
  pop: '0 8px 24px rgba(0, 0, 0, 0.35)',
  lift: '0 2px 8px rgba(0, 0, 0, 0.25)'
})

/** Explicit light theme (colours + shadows), for `stylex.props(theme === 'light' ? light : ...)`. */
export const light = [lightColors, lightShadows] as const

/** Explicit dark theme (colours + shadows). */
export const dark = [darkColors, darkShadows] as const

/** Theme overrides to spread into the root `stylex.props(...)` for a Settings theme. */
export function themeStyles(theme: Theme | undefined): ReadonlyArray<typeof lightColors | typeof lightShadows> {
  if (theme === 'light') return [lightColors, lightShadows]
  if (theme === 'dark') return [darkColors, darkShadows]
  return []
}

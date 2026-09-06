/**
 * Design tokens. Dark is the default;
 * light values follow `prefers-color-scheme`. An explicit theme (Settings) is applied with the
 * `lightTheme` / `darkTheme` overrides from `styles/themes.ts` on the App root.
 * Only `defineVars` / `defineConsts` named exports may live in this file.
 */
import * as stylex from '@stylexjs/stylex'

const LIGHT = '@media (prefers-color-scheme: light)'
const REDUCED = '@media (prefers-reduced-motion: reduce)'

/** Surfaces, text, lines and accents. Themed. */
export const colors = stylex.defineVars({
  bg0: { default: '#141210', [LIGHT]: '#f7f4ee' },
  bg1: { default: '#1a1816', [LIGHT]: '#f0ece4' },
  bg2: { default: 'rgba(44, 40, 36, 0.6)', [LIGHT]: 'rgba(235, 230, 221, 0.6)' },
  bg3: { default: 'rgba(58, 52, 47, 0.65)', [LIGHT]: 'rgba(255, 255, 255, 0.7)' },
  /** Translucent window tint over the native vibrancy material (App root). */
  glass: { default: 'rgba(20, 18, 16, 0.42)', [LIGHT]: 'rgba(247, 244, 238, 0.78)' },
  /** Sidebar tint over `glass`; barely there so the material reads through. */
  glassSide: { default: 'rgba(255, 255, 255, 0.03)', [LIGHT]: 'rgba(20, 18, 16, 0.03)' },
  bgHover: { default: 'rgba(255, 255, 255, 0.04)', [LIGHT]: 'rgba(20, 18, 16, 0.04)' },
  bgActive: { default: 'rgba(255, 255, 255, 0.07)', [LIGHT]: 'rgba(20, 18, 16, 0.08)' },
  scrim: { default: 'rgba(10, 9, 8, 0.6)', [LIGHT]: 'rgba(60, 54, 48, 0.4)' },
  overlayDark: { default: 'rgba(20, 18, 16, 0.72)', [LIGHT]: 'rgba(20, 18, 16, 0.72)' },
  fg1: { default: '#efe9e1', [LIGHT]: '#1d1a17' },
  fg2: { default: 'rgba(239, 233, 225, 0.64)', [LIGHT]: 'rgba(29, 26, 23, 0.66)' },
  fg3: { default: 'rgba(239, 233, 225, 0.48)', [LIGHT]: 'rgba(29, 26, 23, 0.48)' },
  fg4: { default: 'rgba(239, 233, 225, 0.3)', [LIGHT]: 'rgba(29, 26, 23, 0.3)' },
  fgOnAccent: { default: '#141210', [LIGHT]: '#1d1a17' },
  hairline: { default: 'rgba(255, 255, 255, 0.07)', [LIGHT]: 'rgba(20, 18, 16, 0.08)' },
  hairlineStrong: { default: 'rgba(255, 255, 255, 0.12)', [LIGHT]: 'rgba(20, 18, 16, 0.14)' },
  /** Main can push the system accent by setting `--ka-accent` on documentElement. */
  accent: { default: 'var(--ka-accent, #d9a35a)', [LIGHT]: 'var(--ka-accent, #b8813a)' },
  accentSoft: { default: 'rgba(217, 163, 90, 0.16)', [LIGHT]: 'rgba(184, 129, 58, 0.16)' },
  danger: { default: '#d9705a', [LIGHT]: '#b5493a' },
  ok: { default: '#8fb98a', [LIGHT]: '#4f7f4a' },
  /** Warm paper used behind PDF page previews and note cards (same in both themes). */
  paper: { default: '#ece7dd', [LIGHT]: '#ece7dd' },
  /** Ink on `paper` (same in both themes). */
  ink: { default: '#1d1a17', [LIGHT]: '#1d1a17' },
  /** Text drawn over media / `overlayDark` (same in both themes). */
  onMedia: { default: '#efe9e1', [LIGHT]: '#efe9e1' }
})

/** Shadows (restrained; cards at rest have none). Themed. */
export const shadows = stylex.defineVars({
  sheet: { default: '0 24px 64px rgba(0, 0, 0, 0.45)', [LIGHT]: '0 24px 64px rgba(40, 32, 24, 0.22)' },
  pop: { default: '0 8px 24px rgba(0, 0, 0, 0.35)', [LIGHT]: '0 8px 24px rgba(40, 32, 24, 0.16)' },
  lift: { default: '0 2px 8px rgba(0, 0, 0, 0.25)', [LIGHT]: '0 2px 8px rgba(40, 32, 24, 0.12)' },
  /** `filter` value for non-rectangular surfaces (SVG-shaped panels), where `box-shadow` cannot follow the outline. */
  dock: {
    default: 'drop-shadow(0 10px 28px rgba(0, 0, 0, 0.45))',
    [LIGHT]: 'drop-shadow(0 10px 28px rgba(40, 32, 24, 0.22))'
  }
})

export const radii = stylex.defineVars({
  r1: '6px',
  r2: '10px',
  r3: '14px'
})

/** Spacing on a 4 px grid. */
export const space = stylex.defineVars({
  s1: '4px',
  s2: '8px',
  s3: '12px',
  s4: '16px',
  s5: '20px',
  s6: '24px',
  s8: '32px',
  s10: '40px',
  s12: '48px'
})

export const fonts = stylex.defineVars({
  sans: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif",
  serif: "'Instrument Serif', Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, monospace"
})

export const text = stylex.defineVars({
  t11: '11px',
  t12: '12px',
  t13: '13px',
  t15: '15px',
  t20: '20px',
  t28: '28px',
  hero: '44px'
})

export const weight = stylex.defineVars({
  regular: '400',
  medium: '500',
  semibold: '600'
})

/** Durations collapse to 0 under reduced motion. */
export const motion = stylex.defineVars({
  fast: { default: '120ms', [REDUCED]: '0ms' },
  base: { default: '180ms', [REDUCED]: '0ms' },
  slow: { default: '260ms', [REDUCED]: '0ms' },
  /** Panels sliding on and off screen. */
  glide: { default: '420ms', [REDUCED]: '0ms' },
  easeOut: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
  easeInOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
  /** Fast start, long settle: arrivals that should feel weighted rather than springy. */
  easeSettle: 'cubic-bezier(0.16, 1, 0.3, 1)',
  /** Gentle start: departures that get out of the way without snapping. */
  easeLeave: 'cubic-bezier(0.55, 0, 0.75, 0.2)'
})

/** Shell geometry. */
export const layout = stylex.defineVars({
  sidebarWidth: '224px',
  titlebarHeight: '52px',
  toolbarHeight: '48px',
  contentPad: '28px',
  cardMinWidth: '220px',
  cardGap: '14px'
})

/** Stacking order of the shell surfaces. */
export const zIndex = stylex.defineConsts({
  detail: '10',
  selection: '20',
  dialog: '25',
  drop: '30',
  status: '35',
  palette: '50'
})

/** Media queries shared by components. */
export const media = stylex.defineConsts({
  light: LIGHT,
  reducedMotion: REDUCED
})

import * as stylex from '@stylexjs/stylex'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { ARCH_LABEL, ArchBadge, Brand, Button, Icon, type MacArch, MiniMaxWeek, Shot } from '../components'
import type { IconName } from '../components/icon'
import { shared } from '../styles/shared'
import { colors, fonts, radii, space, text, weight } from '../styles/tokens.stylex'

export const Route = createFileRoute('/')({ component: Home })

const GITHUB = 'https://github.com/mnismt/keepanything'
const DOWNLOAD = `${GITHUB}/releases/tag/v0.1.0`

const dmg = (arch: MacArch) => `${GITHUB}/releases/download/v0.1.0/KeepAnything-0.1.0-${arch}.dmg`

// Safari reports an Intel UA on Apple Silicon, so the UA string alone cannot tell the two apart.
// Chromium exposes the CPU via userAgentData; elsewhere the unmasked WebGL renderer names the GPU vendor.
async function detectMacArch(): Promise<MacArch | null> {
  if (!/Mac/.test(navigator.platform)) return null
  const uaData = (
    navigator as Navigator & {
      userAgentData?: { getHighEntropyValues(h: string[]): Promise<{ architecture?: string }> }
    }
  ).userAgentData
  if (uaData) {
    const { architecture } = await uaData
      .getHighEntropyValues(['architecture'])
      .catch(() => ({ architecture: undefined }))
    if (architecture === 'arm') return 'arm64'
    if (architecture === 'x86') return 'x64'
  }
  const gl = document.createElement('canvas').getContext('webgl')
  const ext = gl?.getExtension('WEBGL_debug_renderer_info')
  const renderer = ext ? String(gl?.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''
  if (/Apple/.test(renderer)) return 'arm64'
  if (/Intel|AMD|Radeon/.test(renderer)) return 'x64'
  return null
}

function useMacArch() {
  const [arch, setArch] = useState<MacArch | null>(null)
  useEffect(() => {
    detectMacArch().then(setArch, () => {})
  }, [])
  return arch
}
const AUTHOR = 'https://x.com/capythanh'
const MOBILE = '@media (max-width: 800px)'
const TABLET = '@media (max-width: 1000px)'

// `span` is in columns of the 6-column grid; it collapses to one card per row below 1000px.
const FEATURES: {
  icon: IconName
  title: string
  body: string
  shot: string
  src?: string
  ratio: string
  span: 2 | 3 | 6
}[] = [
  {
    icon: 'inbox',
    title: 'Drop, do not file',
    body: 'The shelf, the menu bar, or ⌘⇧K. Files, folders, links, text and screenshots all land the same way.',
    shot: 'Shelf',
    src: '/shots/shelf.png',
    ratio: '4 / 3',
    span: 2
  },
  {
    icon: 'file',
    title: 'Understood on arrival',
    body: 'Each item gets a real title, a summary and its kind. You never name a folder again.',
    shot: 'Item detail',
    src: '/shots/detail.png',
    ratio: '4 / 3',
    span: 2
  },
  {
    icon: 'waypoints',
    title: 'Things find each other',
    body: 'Collections form when the connection is real. Nothing is filed on a keyword match.',
    shot: 'Collection',
    src: '/shots/collection.png',
    ratio: '4 / 3',
    span: 2
  },
  {
    icon: 'ask',
    title: 'Ask your stuff',
    body: '⌘K, in plain words. Every answer arrives with the items it was built from.',
    shot: 'Ask My Stuff',
    src: '/shots/ask.png',
    ratio: '16 / 10',
    span: 3
  },
  {
    icon: 'search',
    title: 'Search stays home',
    body: 'Full text and meaning, both on device. Works with the network off, and without an account.',
    shot: 'Search results',
    src: '/shots/search.png',
    ratio: '16 / 10',
    span: 3
  },
  {
    icon: 'undo',
    title: 'Nothing is lost',
    body: 'Originals are preserved, never rewritten. Every action is undoable, and the removals you make stick.',
    shot: 'Activity',
    src: '/shots/activity.png',
    ratio: '21 / 9',
    span: 6
  }
]

const styles = stylex.create({
  wrap: {
    width: '100%',
    maxWidth: 1180,
    marginInline: 'auto',
    paddingInline: { default: space.s8, [MOBILE]: space.s5 }
  },
  nav: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 76
  },
  navLinks: {
    display: 'flex',
    alignItems: 'center',
    columnGap: space.s2
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    paddingBlockStart: { default: 88, [MOBILE]: 48 },
    paddingBlockEnd: { default: space.s10, [MOBILE]: space.s8 }
  },
  h1: {
    fontFamily: fonts.serif,
    fontWeight: weight.regular,
    fontSize: 'clamp(40px, 6vw, 68px)',
    lineHeight: 1.04,
    letterSpacing: '-0.02em',
    color: colors.fg1
  },
  h1Rest: {
    display: 'block',
    fontStyle: 'italic',
    color: colors.fg3
  },
  actions: {
    display: 'flex',
    flexDirection: { default: 'row', [MOBILE]: 'column' },
    alignItems: { default: 'center', [MOBILE]: 'flex-start' },
    columnGap: space.s4,
    rowGap: space.s3,
    marginBlockStart: space.s6
  },
  // The button's flex gap already separates "for" from this span; 3px keeps the mark reading as
  // part of the word rather than a second icon.
  mac: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: 3,
    marginInlineStart: -3
  },
  navQuiet: {
    display: { default: 'inline-flex', [MOBILE]: 'none' }
  },
  meta: {
    fontSize: text.t12,
    color: colors.fg4
  },
  metaLink: {
    color: { default: colors.fg3, ':hover': colors.fg1 },
    textDecorationLine: 'underline',
    textDecorationColor: colors.hairlineStrong,
    textUnderlineOffset: 3
  },
  gatekeeper: {
    marginBlockStart: space.s5,
    marginBlockEnd: space.s2
  },
  section: {
    paddingBlockStart: { default: 128, [MOBILE]: 80 }
  },
  h2: {
    fontFamily: fonts.serif,
    fontWeight: weight.regular,
    fontSize: { default: 40, [MOBILE]: text.t28 },
    lineHeight: 1.1,
    letterSpacing: '-0.01em',
    color: colors.fg1
  },
  h2Rest: {
    display: 'block',
    color: colors.fg3
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: { default: 'repeat(6, minmax(0, 1fr))', [TABLET]: 'minmax(0, 1fr)' },
    gap: space.s4,
    marginBlockStart: space.s10
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    paddingInline: { default: space.s6, [MOBILE]: space.s5 },
    paddingBlockStart: { default: space.s6, [MOBILE]: space.s5 },
    borderRadius: radii.r3,
    backgroundColor: colors.bg1,
    boxShadow: `inset 0 0 0 1px ${colors.hairline}`
  },
  span2: { gridColumn: { default: 'span 2', [TABLET]: 'auto' } },
  span3: { gridColumn: { default: 'span 3', [TABLET]: 'auto' } },
  span6: { gridColumn: { default: 'span 6', [TABLET]: 'auto' } },
  media: {
    marginBlockStart: 'auto',
    marginBlockEnd: -48,
    paddingBlockStart: { default: space.s8, [MOBILE]: space.s6 }
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.bg2,
    boxShadow: `inset 0 0 0 1px ${colors.hairline}`,
    color: colors.fg3
  },
  cardTitle: {
    marginBlockStart: space.s5,
    fontSize: text.t20,
    fontWeight: weight.medium,
    letterSpacing: '-0.01em',
    color: colors.fg1
  },
  cardBody: {
    marginBlockStart: space.s2,
    fontSize: text.t13,
    lineHeight: 1.55,
    color: colors.fg3,
    maxInlineSize: '46ch'
  },
  footer: {
    position: 'relative',
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    columnGap: space.s6,
    rowGap: { default: space.s4, [MOBILE]: space.s8 },
    marginBlockStart: { default: 128, [MOBILE]: 80 },
    paddingBlock: space.s10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.hairline,
    fontSize: text.t13,
    color: colors.fg4,
    flexDirection: { default: 'row', [MOBILE]: 'column' },
    alignItems: { default: 'center', [MOBILE]: 'flex-start' }
  },
  footerSide: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: space.s4,
    justifyContent: { default: 'flex-start', [MOBILE]: 'space-between' },
    inlineSize: { default: 'auto', [MOBILE]: '100%' }
  },
  authorCenter: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: space.s3,
    fontSize: text.t13,
    color: { default: colors.fg4, ':hover': colors.fg1 },
    textDecoration: 'none',
    position: { default: 'absolute', [MOBILE]: 'static' },
    insetBlockStart: { default: '50%', [MOBILE]: 'auto' },
    insetInlineStart: { default: '50%', [MOBILE]: 'auto' },
    transform: { default: 'translate(-50%, -50%)', [MOBILE]: 'none' }
  },
  authorAvatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    objectFit: 'cover',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: colors.hairline
  },
  authorHandle: {
    fontWeight: weight.medium,
    color: colors.fg1,
    letterSpacing: 0.1
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: space.s2,
    color: { default: colors.fg4, ':hover': colors.fg1 }
  },
  brandRow: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: space.s4
  },
  footerTail: {
    display: { default: 'contents', [MOBILE]: 'flex' },
    flexDirection: { default: 'row', [MOBILE]: 'row' },
    alignItems: { default: 'center', [MOBILE]: 'center' },
    justifyContent: { default: 'flex-start', [MOBILE]: 'space-between' },
    columnGap: { default: space.s6, [MOBILE]: space.s10 },
    inlineSize: { default: 'auto', [MOBILE]: '100%' }
  }
})

const SPANS = { 2: styles.span2, 3: styles.span3, 6: styles.span6 }

function Card({ icon, title, body, shot, src, ratio, span }: (typeof FEATURES)[number]) {
  return (
    <li {...stylex.props(styles.card, SPANS[span])}>
      <span {...stylex.props(styles.chip)}>
        <Icon name={icon} size={17} />
      </span>
      <h3 {...stylex.props(styles.cardTitle)}>{title}</h3>
      <p {...stylex.props(styles.cardBody)}>{body}</p>
      <div {...stylex.props(styles.media)}>
        <Shot alt={shot} src={src} ratio={ratio} />
      </div>
    </li>
  )
}

function Home() {
  const arch = useMacArch()
  const other: MacArch | null = arch === 'arm64' ? 'x64' : arch === 'x64' ? 'arm64' : null
  const href = arch ? dmg(arch) : DOWNLOAD
  return (
    <>
      <header {...stylex.props(styles.wrap, styles.nav)}>
        <span {...stylex.props(styles.brandRow)}>
          <Brand />
          <span {...stylex.props(styles.navQuiet)}>
            <MiniMaxWeek label={false} />
          </span>
        </span>
        <nav {...stylex.props(styles.navLinks)}>
          <span {...stylex.props(styles.navQuiet)}>
            <Button href={GITHUB} icon="github">
              GitHub
            </Button>
          </span>
          <Button href={href} kind="primary" icon="download" badge={arch && <ArchBadge arch={arch} />}>
            Download
          </Button>
        </nav>
      </header>

      <main>
        <section {...stylex.props(styles.wrap, styles.hero)}>
          <h1 {...stylex.props(styles.h1)}>
            Keep anything.
            <em {...stylex.props(styles.h1Rest)}>We'll figure out the rest.</em>
          </h1>
          <div {...stylex.props(styles.actions)}>
            <Button href={href} kind="primary" icon="download" badge={arch && <ArchBadge arch={arch} />}>
              Download for
              <span {...stylex.props(styles.mac)}>
                <Icon name="apple" size={14} />
                macOS
              </span>
            </Button>
            <span {...stylex.props(styles.meta)}>
              {other ? (
                <a href={dmg(other)} {...stylex.props(shared.hoverFade, styles.metaLink)}>
                  Also for {ARCH_LABEL[other]}
                </a>
              ) : (
                'Apple Silicon or Intel'
              )}
              {' · macOS 13+ · Free'}
            </span>
          </div>
          <p {...stylex.props(styles.meta, styles.gatekeeper)}>
            Open the .dmg and drag KeepAnything into Applications.
          </p>
        </section>

        <div {...stylex.props(styles.wrap)}>
          <Shot alt="Library window" src="/shots/hero.png" ratio="1192 / 849" shadow="sheet" />
        </div>

        <section {...stylex.props(styles.wrap, styles.section)}>
          <h2 {...stylex.props(styles.h2)}>
            Everything it does
            <span {...stylex.props(styles.h2Rest)}>while you keep working.</span>
          </h2>
          <ul {...stylex.props(styles.cards)}>
            {FEATURES.map((feature) => (
              <Card key={feature.title} {...feature} />
            ))}
          </ul>
        </section>
      </main>
      <footer {...stylex.props(styles.wrap, styles.footer)}>
        <span {...stylex.props(styles.footerSide)}>
          <Brand />
          <MiniMaxWeek />
        </span>
        <span {...stylex.props(styles.footerTail)}>
          <a
            href={AUTHOR}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="@capythanh on X"
            {...stylex.props(shared.hoverFade, styles.authorCenter)}
          >
            <img {...stylex.props(styles.authorAvatar)} src="/avatars/capythanh.jpg" alt="" />
            <strong {...stylex.props(styles.authorHandle)}>@capythanh</strong>
          </a>
          <a href={GITHUB} target="_blank" rel="noopener noreferrer" {...stylex.props(shared.hoverFade, styles.link)}>
            <Icon name="github" size={14} />
            GitHub
          </a>
        </span>
      </footer>
    </>
  )
}

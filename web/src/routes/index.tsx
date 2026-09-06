import * as stylex from '@stylexjs/stylex'
import { createFileRoute } from '@tanstack/react-router'
import { Brand, Button, Icon, Shot } from '../components'
import type { IconName } from '../components/icon'
import { shared } from '../styles/shared'
import { colors, fonts, radii, space, text, weight } from '../styles/tokens.stylex'

export const Route = createFileRoute('/')({ component: Home })

const GITHUB = 'https://github.com/mnismt/keepanything'
// The repo is private with no releases yet; repoint once the first build is published.
const DOWNLOAD = `${GITHUB}/releases/latest`
const AUTHOR = 'https://x.com/capythanh'
const MOBILE = '@media (max-width: 800px)'
const TABLET = '@media (max-width: 1000px)'

// `span` is in columns of the 6-column grid; it collapses to one card per row below 1000px.
const FEATURES: { icon: IconName; title: string; body: string; shot: string; ratio: string; span: 2 | 3 | 6 }[] = [
  {
    icon: 'inbox',
    title: 'Drop, do not file',
    body: 'The shelf, the menu bar, or ⌘⇧K. Files, folders, links, text and screenshots all land the same way.',
    shot: 'Shelf',
    ratio: '4 / 3',
    span: 2
  },
  {
    icon: 'file',
    title: 'Understood on arrival',
    body: 'Each item gets a real title, a summary and its kind. You never name a folder again.',
    shot: 'Item detail',
    ratio: '4 / 3',
    span: 2
  },
  {
    icon: 'waypoints',
    title: 'Things find each other',
    body: 'Collections form when the connection is real. Nothing is filed on a keyword match.',
    shot: 'Collection',
    ratio: '4 / 3',
    span: 2
  },
  {
    icon: 'ask',
    title: 'Ask your stuff',
    body: '⌘K, in plain words. Every answer arrives with the items it was built from.',
    shot: 'Ask My Stuff',
    ratio: '16 / 10',
    span: 3
  },
  {
    icon: 'search',
    title: 'Search stays home',
    body: 'Full text and meaning, both on device. Works with the network off, and without an account.',
    shot: 'Search results',
    ratio: '16 / 10',
    span: 3
  },
  {
    icon: 'undo',
    title: 'Nothing is lost',
    body: 'Originals are preserved, never rewritten. Every action is undoable, and the removals you make stick.',
    shot: 'Activity',
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
  navQuiet: {
    display: { default: 'inline-flex', [MOBILE]: 'none' }
  },
  meta: {
    fontSize: text.t12,
    color: colors.fg4
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
  cta: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    rowGap: space.s6,
    textAlign: 'center',
    paddingBlock: { default: 160, [MOBILE]: 96 }
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.s6,
    paddingBlock: space.s8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.hairline,
    fontSize: text.t13,
    color: colors.fg4
  },
  link: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: space.s2,
    color: { default: colors.fg4, ':hover': colors.fg1 }
  },
  author: {
    fontWeight: weight.medium,
    color: 'inherit'
  }
})

const SPANS = { 2: styles.span2, 3: styles.span3, 6: styles.span6 }

function Card({ icon, title, body, shot, ratio, span }: (typeof FEATURES)[number]) {
  return (
    <li {...stylex.props(styles.card, SPANS[span])}>
      <span {...stylex.props(styles.chip)}>
        <Icon name={icon} size={17} />
      </span>
      <h3 {...stylex.props(styles.cardTitle)}>{title}</h3>
      <p {...stylex.props(styles.cardBody)}>{body}</p>
      <div {...stylex.props(styles.media)}>
        <Shot alt={shot} ratio={ratio} />
      </div>
    </li>
  )
}

function Home() {
  return (
    <>
      <header {...stylex.props(styles.wrap, styles.nav)}>
        <Brand />
        <nav {...stylex.props(styles.navLinks)}>
          <span {...stylex.props(styles.navQuiet)}>
            <Button href={GITHUB} icon="github">
              GitHub
            </Button>
          </span>
          <Button href={DOWNLOAD} kind="primary" icon="download">
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
            <Button href={DOWNLOAD} kind="primary" icon="download">
              Download for macOS
            </Button>
            <span {...stylex.props(styles.meta)}>Apple Silicon · macOS 13+ · Free</span>
          </div>
        </section>

        <div {...stylex.props(styles.wrap)}>
          <Shot alt="Library window" ratio="16 / 9" shadow="sheet" caption="Drop it. It is kept, then understood." />
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

        <section {...stylex.props(styles.wrap, styles.cta)}>
          <h2 {...stylex.props(styles.h2)}>Start keeping.</h2>
          <Button href={DOWNLOAD} kind="primary" icon="download">
            Download for macOS
          </Button>
          <p {...stylex.props(styles.meta)}>Unsigned build. The first time, right-click and choose Open.</p>
        </section>
      </main>
      <footer {...stylex.props(styles.wrap, styles.footer)}>
        <Brand />
        <a href={AUTHOR} target="_blank" rel="noopener noreferrer" {...stylex.props(shared.hoverFade, styles.link)}>
          <Icon name="user" size={14} />
          <strong {...stylex.props(styles.author)}>@capythanh</strong>
        </a>
        <a href={GITHUB} target="_blank" rel="noopener noreferrer" {...stylex.props(shared.hoverFade, styles.link)}>
          <Icon name="github" size={14} />
          GitHub
        </a>
      </footer>
    </>
  )
}

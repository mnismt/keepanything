import * as stylex from '@stylexjs/stylex'
import { createFileRoute } from '@tanstack/react-router'
import { Brand, Button, Icon, MiniMaxWeek, Shot } from '../components'
import { shared } from '../styles/shared'
import { colors, fonts, space, text, weight } from '../styles/tokens.stylex'

export const Route = createFileRoute('/')({ component: Home })

const GITHUB = 'https://github.com/mnismt/keepanything'
// The repo is private with no releases yet; repoint once the first build is published.
const DOWNLOAD = `${GITHUB}/releases/latest`
const AUTHOR = 'https://x.com/capythanh'
const MOBILE = '@media (max-width: 800px)'

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
  gatekeeper: {
    marginBlockStart: space.s5,
    marginBlockEnd: space.s2
  },
  code: {
    fontFamily: fonts.mono,
    fontSize: text.t12,
    color: colors.fg2,
    userSelect: 'all'
  },
  footer: {
    position: 'relative',
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: space.s6,
    rowGap: space.s4,
    marginBlockStart: { default: 128, [MOBILE]: 80 },
    paddingBlock: space.s10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: colors.hairline,
    fontSize: text.t13,
    color: colors.fg4
  },
  footerSide: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: space.s4
  },
  authorCenter: {
    position: 'absolute',
    insetBlockStart: '50%',
    insetInlineStart: '50%',
    transform: 'translate(-50%, -50%)',
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: space.s3,
    fontSize: text.t13,
    color: { default: colors.fg4, ':hover': colors.fg1 },
    textDecoration: 'none'
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
  }
})

function Home() {
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
          <p {...stylex.props(styles.meta, styles.gatekeeper)}>
            Unsigned build. If macOS says the app is damaged, run this once in Terminal, then open it:
          </p>
          <code {...stylex.props(styles.code)}>xattr -dr com.apple.quarantine /Applications/KeepAnything.app</code>
        </section>

        <div {...stylex.props(styles.wrap)}>
          <Shot alt="Library window" src="/shots/hero.png" ratio="1208 / 802" shadow="sheet" />
        </div>
      </main>
      <footer {...stylex.props(styles.wrap, styles.footer)}>
        <span {...stylex.props(styles.footerSide)}>
          <Brand />
          <MiniMaxWeek />
        </span>
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
        <a
          href={GITHUB}
          target="_blank"
          rel="noopener noreferrer"
          {...stylex.props(shared.hoverFade, styles.link, styles.footerSide)}
        >
          <Icon name="github" size={14} />
          GitHub
        </a>
      </footer>
    </>
  )
}

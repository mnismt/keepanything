import * as stylex from '@stylexjs/stylex'
import { useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CollectionDialog, CollectionHeader, CollectionsGrid } from './components/collections'
import { ItemDetail } from './components/detail'
import { type EmptyKind, EmptyState, MasonryGrid, TrashHeader } from './components/library'
import { CommandPalette } from './components/palette'
import { SelectionBar } from './components/selection'
import { SettingsView } from './components/settings'
import { ShelfView } from './components/shelf'
import { DropOverlay, Sidebar, StatusStack, Toolbar } from './components/shell'
import { useShellKeys } from './hooks/use-shell-keys'
import { useWindowCapture } from './hooks/use-window-capture'
import type { MasonryLayout } from './lib/masonry'
import { selectVisibleItems, useLibrary } from './state/library'
import { useSettings } from './state/settings'
import { useUi } from './state/ui'
import { shared } from './styles/shared'
import { themeStyles } from './styles/themes'
import { colors, fonts, layout, space, text } from './styles/tokens.stylex'

const styles = stylex.create({
  root: {
    height: '100%',
    width: '100%',
    backgroundColor: colors.glass,
    color: colors.fg1,
    fontFamily: fonts.sans,
    fontSize: text.t13
  },
  schemeLight: { colorScheme: 'light' },
  schemeDark: { colorScheme: 'dark' },
  app: { display: 'flex', height: '100%', width: '100%', position: 'relative', overflow: 'hidden' },
  main: { position: 'relative', flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' },
  content: { position: 'relative', flexGrow: 1, minHeight: 0, display: 'flex', flexDirection: 'column' },
  loading: { flexGrow: 1 },
  shelfRoot: { height: '100%', padding: 6, backgroundColor: 'transparent' },
  error: { paddingBlock: space.s6, paddingInline: layout.contentPad, color: colors.fg2, fontSize: text.t15 },
  errorDetail: { marginTop: space.s2, color: colors.fg4, fontSize: text.t12 }
})

/**
 * Routes `?view=library|shelf` and mounts the fixed component slots.
 */
export function App(): React.JSX.Element {
  const route = useUi((s) => s.route)
  const theme = useSettings((s) => s.settings?.theme)
  return (
    <div
      {...stylex.props(
        styles.root,
        route === 'shelf' && styles.shelfRoot,
        theme === 'light' && styles.schemeLight,
        theme === 'dark' && styles.schemeDark,
        ...themeStyles(theme)
      )}
      data-theme={theme ?? 'system'}
    >
      {route === 'shelf' ? <ShelfView /> : <LibraryApp />}
    </div>
  )
}

function emptyKindFor(section: string, filtered: boolean): EmptyKind {
  if (filtered) return 'filtered'
  switch (section) {
    case 'collection':
      return 'collection'
    case 'trash':
      return 'trash'
    case 'links':
      return 'links'
    case 'files':
      return 'files'
    default:
      return 'library'
  }
}

function LibraryApp(): React.JSX.Element {
  const section = useUi((s) => s.section)
  const collectionId = useUi((s) => s.collectionId)
  const modalStack = useUi((s) => s.modalStack)
  const items = useLibrary(useShallow(selectVisibleItems))
  const loadedOnce = useLibrary((s) => s.loadedOnce)
  const error = useLibrary((s) => s.error)
  const filtered = useLibrary((s) => s.query.types.length > 0)
  const layoutRef = useRef<MasonryLayout | null>(null)
  const onLayout = useCallback((l: MasonryLayout) => {
    layoutRef.current = l
  }, [])

  useShellKeys(layoutRef)
  useWindowCapture()

  const detail = modalStack.find((m) => m.kind === 'detail')
  const dialog = modalStack.find((m) => m.kind === 'dialog')
  const palette = modalStack.some((m) => m.kind === 'palette')
  const contentInert = Boolean(detail || dialog || palette)

  return (
    <div {...stylex.props(styles.app)} data-route="library">
      <Sidebar />
      <main {...stylex.props(styles.main)}>
        <Toolbar />
        <div {...stylex.props(styles.content)} inert={contentInert ? true : undefined}>
          {section === 'collection' && collectionId ? <CollectionHeader collectionId={collectionId} /> : null}
          {section === 'collections' ? (
            <CollectionsGrid />
          ) : error ? (
            <div {...stylex.props(styles.error)}>
              <p>Couldn't load the library.</p>
              <p {...stylex.props(styles.errorDetail, shared.selectable)}>{error}</p>
            </div>
          ) : !loadedOnce ? (
            <div {...stylex.props(styles.loading)} aria-busy="true" />
          ) : items.length === 0 ? (
            <EmptyState kind={emptyKindFor(section, filtered)} />
          ) : (
            <>
              {section === 'trash' ? <TrashHeader /> : null}
              <MasonryGrid items={items} onLayout={onLayout} />
            </>
          )}
          <SelectionBar />
        </div>
        {detail && detail.kind === 'detail' ? <ItemDetail itemId={detail.itemId} /> : null}
        <DropOverlay />
      </main>
      {dialog && dialog.kind === 'dialog' && dialog.id === 'settings' ? <SettingsView /> : null}
      {dialog && dialog.kind === 'dialog' && dialog.id === 'newCollection' ? <CollectionDialog mode="new" /> : null}
      {dialog && dialog.kind === 'dialog' && dialog.id === 'newDynamicCollection' ? (
        <CollectionDialog mode="dynamic" />
      ) : null}
      {dialog && dialog.kind === 'dialog' && dialog.id === 'renameCollection' ? (
        <CollectionDialog mode="rename" collectionId={dialog.collectionId} />
      ) : null}
      {dialog && dialog.kind === 'dialog' && dialog.id === 'deleteCollection' ? (
        <CollectionDialog mode="delete" collectionId={dialog.collectionId} />
      ) : null}
      {palette ? <CommandPalette /> : null}
      <StatusStack />
    </div>
  )
}

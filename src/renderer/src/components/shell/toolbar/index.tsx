import * as stylex from '@stylexjs/stylex'
import { ChevronDown, LayoutGrid, Rows3, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ItemsSort, ItemType } from '../../../../../shared/types'
import { count, shortcut } from '../../../lib/format'
import { platform } from '../../../lib/ipc-client'
import { useCollections } from '../../../state/collections'
import { useLibrary } from '../../../state/library'
import { useUi } from '../../../state/ui'
import { shared } from '../../../styles/shared'
import { Kbd } from '../../common'
import { styles } from './styles'

const TITLES: Record<string, string> = {
  library: 'Library',
  links: 'Links',
  files: 'Files',
  trash: 'Trash',
  collections: 'Collections'
}

const TYPE_FILTERS: Array<{ value: ItemType | ''; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'url', label: 'Links' },
  { value: 'image', label: 'Images' },
  { value: 'pdf', label: 'PDFs' },
  { value: 'video', label: 'Videos' },
  { value: 'folder', label: 'Folders' },
  { value: 'text', label: 'Text' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'note', label: 'Notes' },
  { value: 'file', label: 'Files' }
]

function Control({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <label {...stylex.props(shared.hoverFade, styles.control, shared.noDrag)}>
      <span {...stylex.props(shared.srOnly)}>{label}</span>
      {children}
      <ChevronDown {...stylex.props(styles.chevron)} size={12} strokeWidth={1.5} />
    </label>
  )
}

/** Title, count, search button (⌘K), type filter, sort, density, grid/list. */
export function Toolbar(): React.JSX.Element {
  const section = useUi((s) => s.section)
  const collectionId = useUi((s) => s.collectionId)
  const openPalette = useUi((s) => s.openPalette)
  const collection = useCollections((s) => (collectionId ? s.list.find((c) => c.id === collectionId) : undefined))
  const total = useLibrary((s) => s.order.length)
  const query = useLibrary((s) => s.query)
  const layoutMode = useLibrary((s) => s.layout)
  const density = useLibrary((s) => s.density)
  const setTypes = useLibrary((s) => s.setTypes)
  const setSort = useLibrary((s) => s.setSort)
  const setLayout = useLibrary((s) => s.setLayout)
  const setDensity = useLibrary((s) => s.setDensity)

  const title = section === 'collection' ? (collection?.name ?? 'Collection') : (TITLES[section] ?? 'Library')
  const showControls = section !== 'collections'

  return (
    <header {...stylex.props(styles.toolbar, shared.drag)}>
      <h1 {...stylex.props(styles.title, shared.ellipsis, shared.noDrag)}>{title}</h1>
      {showControls && total > 0 ? (
        <span {...stylex.props(styles.meta, shared.noDrag)}>{count(total, 'item')}</span>
      ) : null}
      <div {...stylex.props(styles.spacer)} />
      <button
        type="button"
        {...stylex.props(styles.search, shared.noDrag)}
        onClick={() => openPalette()}
        aria-label="Search anything"
      >
        <Search size={14} strokeWidth={1.5} />
        <span {...stylex.props(styles.searchText, shared.ellipsis)}>Search anything…</span>
        <Kbd>{shortcut('⌘K', platform())}</Kbd>
      </button>
      {showControls ? (
        <>
          <Control label="Filter by type">
            <select
              {...stylex.props(styles.select)}
              value={query.types[0] ?? ''}
              onChange={(e) => setTypes(e.target.value ? [e.target.value as ItemType] : [])}
            >
              {TYPE_FILTERS.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
          </Control>
          <Control label="Sort">
            <select
              {...stylex.props(styles.select)}
              value={query.sort}
              onChange={(e) => setSort(e.target.value as ItemsSort)}
            >
              <option value="captured">Recently kept</option>
              <option value="created">Recently created</option>
              <option value="title">Title</option>
            </select>
          </Control>
          <Control label="Density">
            <select
              {...stylex.props(styles.select)}
              value={density}
              onChange={(e) => setDensity(e.target.value as typeof density)}
            >
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </Control>
          <div {...stylex.props(styles.seg, shared.noDrag)} role="group" aria-label="Layout">
            <button
              type="button"
              {...stylex.props(shared.hoverFade, styles.segBtn, layoutMode === 'grid' && styles.segOn)}
              aria-label="Grid"
              aria-pressed={layoutMode === 'grid'}
              onClick={() => setLayout('grid')}
            >
              <LayoutGrid size={14} strokeWidth={1.5} />
            </button>
            <button
              type="button"
              {...stylex.props(shared.hoverFade, styles.segBtn, layoutMode === 'list' && styles.segOn)}
              aria-label="List"
              aria-pressed={layoutMode === 'list'}
              onClick={() => setLayout('list')}
            >
              <Rows3 size={14} strokeWidth={1.5} />
            </button>
          </div>
        </>
      ) : null}
    </header>
  )
}

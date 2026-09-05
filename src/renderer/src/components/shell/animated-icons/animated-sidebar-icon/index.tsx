import { CollectionsIcon } from '../collections-icon'
import { FileIcon } from '../file-icon'
import { InboxIcon } from '../inbox-icon'
import { LibraryIcon } from '../library-icon'
import { LinksIcon } from '../links-icon'
import { TrashIcon } from '../trash-icon'
import type { AnimatedSidebarIconProps } from '../types'

/**
 * Names of icons the sidebar can render. Kept as a string union so `name` is checked at the
 * call site — a typo here is a build error.
 */
export type AnimatedSidebarIconName = 'library' | 'inbox' | 'links' | 'file' | 'collections' | 'trash'
type IconComponent = (props: AnimatedSidebarIconProps) => React.JSX.Element
const REGISTRY: Record<AnimatedSidebarIconName, IconComponent> = {
  library: LibraryIcon,
  inbox: InboxIcon,
  links: LinksIcon,
  file: FileIcon,
  collections: CollectionsIcon,
  trash: TrashIcon
}

/**
 * Resolves the icon component by name. The row owns `active` and `reducedMotion` so the
 * wrapper stays a pure presentational prop pipe.
 */
export function AnimatedSidebarIcon({
  name,
  ...rest
}: { name: AnimatedSidebarIconName } & AnimatedSidebarIconProps): React.JSX.Element {
  const Icon = REGISTRY[name]
  return <Icon {...rest} />
}

export type { AnimatedSidebarIconProps }
export { CollectionsIcon, FileIcon, InboxIcon, LibraryIcon, LinksIcon, TrashIcon }

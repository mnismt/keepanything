import { app, Menu, type MenuItemConstructorOptions, shell } from 'electron'
import { isDev } from '../env'

export interface AppMenuActions {
  showLibrary(): void
  toggleShelf(): void
  /** "Add Files…" (⌘O): open the file dialog and keep the selection. */
  addFiles(): Promise<void>
  /** "Paste" is left to the renderer; "Empty Trash"/"New Collection" too (they need UI state). */
}

/**
 * Application menu: standard roles plus the few things main can do on its own. Keyboard shortcuts
 * that need UI state (⌘K palette, ⌘, settings, ⌘N collection) stay in the renderer so menu
 * accelerators never swallow them; ⌘⇧K is a global shortcut (`shortcuts.ts`), not a menu accelerator,
 * so it does not fire twice while the app is focused.
 */
export function installAppMenu(actions: AppMenuActions): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        { label: 'Add Files…', accelerator: 'CommandOrControl+O', click: () => void actions.addFiles() },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        ...(isDev
          ? ([
              { role: 'reload' },
              { role: 'forceReload' },
              { role: 'toggleDevTools' },
              { type: 'separator' }
            ] as MenuItemConstructorOptions[])
          : []),
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { label: 'Library', accelerator: 'CommandOrControl+1', click: () => actions.showLibrary() },
        { label: 'Toggle Shelf', click: () => actions.toggleShelf() },
        { type: 'separator' },
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' }
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'KeepAnything on GitHub',
          click: () => void shell.openExternal('https://github.com/mnismt/keepanything')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

import { spawn } from 'node:child_process'
import { dialog, shell } from 'electron'
import { KaError } from '../core/errors'
import type { DesktopActions } from '../ipc/handlers'
import type { Repositories } from '../storage/repositories'
import { showContextMenu } from './context-menu'
import type { WindowManager } from './windows'

export function createDesktopActions(windows: WindowManager, repos: Repositories): DesktopActions {
  return {
    async openPath(path) {
      const error = await shell.openPath(path)
      if (error) throw new KaError('INTERNAL', "Couldn't open that file.", error)
    },
    showItemInFolder(path) {
      shell.showItemInFolder(path)
    },
    async quickLook(path) {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('/usr/bin/qlmanage', ['-p', path], { detached: true, stdio: 'ignore' })
        child.once('error', (error) => reject(new KaError('INTERNAL', "Quick Look isn't available.", error)))
        child.once('spawn', () => {
          child.unref()
          resolve()
        })
      })
    },
    async openExternal(url) {
      if (!/^https?:\/\//i.test(url)) throw new KaError('VALIDATION', 'Only web links can be opened.')
      await shell.openExternal(url)
    },
    async chooseFiles() {
      const parent = windows.libraryWindow()
      const options: Electron.OpenDialogOptions = {
        title: 'Keep files or folders',
        buttonLabel: 'Keep',
        properties: ['openFile', 'openDirectory', 'multiSelections', 'treatPackageAsDirectory']
      }
      const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
      return result.canceled ? [] : result.filePaths
    },
    noteShelfDrop() {
      windows.noteShelfDrop()
    },
    contextMenu(kind, ids, collectionId) {
      const items = repos.items.getMany(ids)
      const collections = repos.collections.list()
      return showContextMenu({ kind, items, collections, collectionId }, windows.libraryWindow())
    }
  }
}

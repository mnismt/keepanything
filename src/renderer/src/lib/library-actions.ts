/**
 * Library-wide actions shared by cards, the selection bar, the palette and context menus.
 */
import type { CommandTemplate } from '../../../shared/types'
import { useCollections } from '../state/collections'
import { useToasts } from '../state/toasts'
import { useUi } from '../state/ui'
import { buildSelectionCommand } from './commands'
import { count } from './format'
import { describeError, invoke } from './ipc-client'

/** Remove items from a collection with an Undo toast (writes a suppression in main). */
export async function removeFromCollection(collectionId: string, ids: string[]): Promise<void> {
  const collections = useCollections.getState()
  const name = collections.byId(collectionId)?.name ?? 'the collection'
  let ok = true
  for (const id of ids) ok = (await collections.removeItem(collectionId, id)) && ok
  if (!ok) {
    useToasts.getState().push({ text: "Couldn't remove that right now." })
    return
  }
  useToasts.getState().push({
    text: `Removed ${count(ids.length, 'item')} from ${name}.`,
    detail: 'It will not be added back automatically.',
    action: { label: 'Undo', run: () => collections.addItems(collectionId, ids) }
  })
}

/** Add items to a collection with an Undo toast. */
export async function addToCollection(collectionId: string, ids: string[]): Promise<boolean> {
  const collections = useCollections.getState()
  const name = collections.byId(collectionId)?.name ?? 'collection'
  const ok = await collections.addItems(collectionId, ids)
  if (!ok) {
    useToasts.getState().push({ text: "Couldn't add to that collection." })
    return false
  }
  useToasts.getState().push({
    text: `Added ${count(ids.length, 'item')} to ${name}.`,
    action: {
      label: 'Undo',
      run: async () => {
        for (const id of ids) await collections.removeItem(collectionId, id)
      }
    }
  })
  return true
}

/** Start a multi-item command and hand the run to the palette. */
export async function startSelectionCommand(template: CommandTemplate, ids: string[]): Promise<void> {
  const request = buildSelectionCommand(template, ids)
  const result = await invoke('agent:command', request)
  if (result.ok) useUi.getState().openRun(result.data.runId, request.question)
  else useToasts.getState().push({ text: describeError(result.error) })
}

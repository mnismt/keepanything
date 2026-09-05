/**
 * Whole-window drop target + ⌘V paste. Sends the RAW dataTransfer snapshot to `capture:drop`
 * (zero classification here); blob files without a path go to `capture:blob`.
 */
import { useEffect } from 'react'
import { COPY } from '../../../shared/constants'
import { blobFiles, hasExternalPayload, isInternalDrag, snapshotDrop, snapshotPaste } from '../lib/dnd'
import { getPathForFile, invoke } from '../lib/ipc-client'
import { useLibrary } from '../state/library'
import { useToasts } from '../state/toasts'
import { useUi } from '../state/ui'

async function captureBlobs(files: File[]): Promise<number> {
  let n = 0
  for (const file of files) {
    const bytes = await file.arrayBuffer()
    const r = await invoke('capture:blob', {
      name: file.name || 'Pasted image.png',
      mimeType: file.type || 'application/octet-stream',
      bytes
    })
    if (r.ok) n += r.data.items.length
  }
  return n
}

function announce(created: number, duplicates: number): void {
  const toasts = useToasts.getState()
  if (created === 0 && duplicates === 0) return
  if (created === 0) {
    toasts.push({ text: duplicates === 1 ? 'Already kept.' : `Already kept · ${duplicates} items.` })
    return
  }
  toasts.push({
    text: created === 1 ? COPY.saved : `Saved ${created} things.`,
    detail: duplicates > 0 ? `${duplicates} already kept` : undefined
  })
}

export function useWindowCapture(): void {
  useEffect(() => {
    let depth = 0
    const ui = useUi.getState

    const onDragEnter = (e: DragEvent): void => {
      if (isInternalDrag(e.dataTransfer) || !hasExternalPayload(e.dataTransfer)) return
      depth += 1
      ui().setDragOver(true)
    }
    const onDragOver = (e: DragEvent): void => {
      if (isInternalDrag(e.dataTransfer) || !hasExternalPayload(e.dataTransfer)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (): void => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) ui().setDragOver(false)
    }
    const onDrop = async (e: DragEvent): Promise<void> => {
      depth = 0
      ui().setDragOver(false)
      if (!e.dataTransfer || isInternalDrag(e.dataTransfer)) return
      if (!hasExternalPayload(e.dataTransfer)) return
      e.preventDefault()
      const { section, collectionId } = ui()
      const request = snapshotDrop(
        e.dataTransfer,
        getPathForFile,
        'library',
        section === 'collection' && collectionId ? collectionId : undefined
      )
      const blobs = blobFiles(e.dataTransfer, getPathForFile)
      let created = 0
      let duplicates = 0
      if (request.files.length > 0 || request.uriList || request.text || request.html) {
        const r = await invoke('capture:drop', request)
        if (r.ok) {
          created += r.data.items.filter((i) => i.status === 'created').length
          duplicates += r.data.items.filter((i) => i.status === 'duplicate').length
        } else useToasts.getState().push({ text: r.error.message })
      }
      if (blobs.length > 0) created += await captureBlobs(blobs)
      announce(created, duplicates)
      if (created > 0 && useLibrary.getState().query.view === 'trash') useLibrary.getState().setView('library')
    }
    const onPaste = async (e: ClipboardEvent): Promise<void> => {
      const target = e.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      )
        return
      if (ui().modalStack.some((m) => m.kind === 'palette' || m.kind === 'dialog')) return
      const dt = e.clipboardData
      if (!dt) return
      const blobs = blobFiles(dt, getPathForFile)
      const { section, collectionId } = ui()
      const request =
        blobs.length > 0
          ? null
          : snapshotPaste(
              dt,
              getPathForFile,
              'library',
              section === 'collection' && collectionId ? collectionId : undefined
            )
      if (!request && blobs.length === 0) return
      e.preventDefault()
      let created = 0
      let duplicates = 0
      if (request) {
        const r = await invoke('capture:drop', request)
        if (r.ok) {
          created += r.data.items.filter((i) => i.status === 'created').length
          duplicates += r.data.items.filter((i) => i.status === 'duplicate').length
        } else useToasts.getState().push({ text: r.error.message })
      }
      if (blobs.length > 0) created += await captureBlobs(blobs)
      announce(created, duplicates)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', (e) => void onDrop(e))
    window.addEventListener('paste', (e) => void onPaste(e))
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
    }
  }, [])
}

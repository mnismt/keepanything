import { KaError } from '../../core/errors'
import type { Intake } from '../../ports'
import type { HandlerMap } from '../router'
import type { HandlerDeps } from './deps'

type CaptureHandlers = Pick<
  HandlerMap,
  'capture:files' | 'capture:url' | 'capture:text' | 'capture:blob' | 'capture:drop'
>

/** Capture handlers; delegate to the `Intake` port. */
export function createCaptureHandlers(deps: HandlerDeps): CaptureHandlers {
  const intake = (): Intake => {
    if (!deps.intake) throw new KaError('NOT_IMPLEMENTED', "Keeping things isn't available in this build yet.")
    return deps.intake
  }
  return {
    'capture:files': ({ paths, mode }) => intake().captureFiles(paths, mode, { source: 'dialog' }),
    'capture:url': ({ url }) => intake().captureUrl(url, { source: 'paste' }),
    'capture:text': ({ text, title }) => intake().captureText(text, title, { source: 'paste' }),
    'capture:blob': ({ name, mimeType, bytes }) => {
      const view = ArrayBuffer.isView(bytes)
        ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
        : new Uint8Array(bytes)
      return intake().captureBlob({ name, mimeType, bytes: view }, { source: 'paste' })
    },
    'capture:drop': async (payload) => {
      // Before the await: the drag is already over, and the shelf is otherwise about to auto-hide.
      if (payload.source === 'shelf') deps.desktop.noteShelfDrop()
      const result = await intake().captureDrop(payload)
      if (payload.source === 'shelf') deps.push.send('shelf:dropped', { result })
      return result
    }
  }
}

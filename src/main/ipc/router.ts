import {
  IPC_CHANNEL_LIST,
  type IpcChannel,
  type IpcEnvelope,
  type IpcRequest,
  type IpcResponse
} from '../../shared/ipc'
import { isKaError } from '../core/errors'
import type { Logger } from '../ports'
import { describeIssues, schemaFor } from './schemas'

export interface HandlerContext {
  senderId: number
}

/** One channel handler. Throws `KaError` for user-facing failures. */
export type Handler<C extends IpcChannel> = (
  payload: IpcRequest<C>,
  ctx: HandlerContext
) => Promise<IpcResponse<C>> | IpcResponse<C>

/** Every channel must have a handler (checked at compile time). */
export type HandlerMap = { [C in IpcChannel]: Handler<C> }

/** The minimum of `ipcMain.handle` the router needs (injectable for tests). */
export type HandleFn = (
  channel: string,
  listener: (event: { sender: { id: number } }, payload: unknown) => Promise<unknown>
) => void

export interface RouterOptions {
  handle: HandleFn
  /** True when `webContents.id` belongs to one of our app windows (snapshot windows are rejected). */
  isKnownSender: (id: number) => boolean
  handlers: HandlerMap
  logger: Logger
}

/**
 * Registers every `IPC_CHANNELS` entry: sender check -> zod validation -> handler -> envelope.
 * `KaError` maps to its code; anything else is logged and returned as `INTERNAL` with a generic
 * message (never a stack or internal detail).
 */
export function createRouter(options: RouterOptions): void {
  const { handle, isKnownSender, handlers, logger } = options
  for (const channel of IPC_CHANNEL_LIST) {
    handle(channel, (event, payload) => dispatch(channel, event.sender.id, payload))
  }

  async function dispatch<C extends IpcChannel>(
    channel: C,
    senderId: number,
    payload: unknown
  ): Promise<IpcEnvelope<IpcResponse<C>>> {
    if (!isKnownSender(senderId)) {
      logger.warn('ipc from unknown sender rejected', { channel, senderId })
      return { ok: false, error: { code: 'VALIDATION', message: 'Unknown sender' } }
    }
    const parsed = schemaFor(channel).safeParse(payload)
    if (!parsed.success) {
      return { ok: false, error: { code: 'VALIDATION', message: describeIssues(parsed.error) } }
    }
    try {
      const handler = handlers[channel] as Handler<C>
      const data = await handler(parsed.data, { senderId })
      return { ok: true, data }
    } catch (error) {
      if (isKaError(error)) {
        if (error.code === 'INTERNAL') logger.error('ipc handler failed', { channel, error })
        else logger.debug('ipc handler rejected', { channel, code: error.code, message: error.message })
        return { ok: false, error: { code: error.code, message: error.message } }
      }
      logger.error('ipc handler threw', { channel, error })
      return { ok: false, error: { code: 'INTERNAL', message: 'Something went wrong. It has been logged.' } }
    }
  }
}

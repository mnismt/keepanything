import { describe, expect, it } from 'vitest'
import { KaError } from '../../src/main/core/errors'
import { createEventBus } from '../../src/main/core/events'
import { bridgeDomainEvents, createIpcPush } from '../../src/main/ipc/events'
import { createRouter, type HandlerMap } from '../../src/main/ipc/router'
import { describeIssues, REQUEST_SCHEMAS, schemaFor } from '../../src/main/ipc/schemas'
import { silentLogger } from '../../src/main/lib/logger'
import { IPC_CHANNEL_LIST, type IpcChannel } from '../../src/shared/ipc'

describe('request schemas', () => {
  it('has a schema for every channel', () => {
    for (const channel of IPC_CHANNEL_LIST) expect(REQUEST_SCHEMAS[channel]).toBeDefined()
  })

  const accepts = (channel: IpcChannel, payload: unknown): void => {
    const r = schemaFor(channel).safeParse(payload)
    expect(r.success, r.success ? '' : describeIssues(r.error)).toBe(true)
  }
  const rejects = (channel: IpcChannel, payload: unknown): void => {
    expect(schemaFor(channel).safeParse(payload).success).toBe(false)
  }

  it('accepts valid payloads', () => {
    accepts('items:list', { view: 'library' })
    accepts('items:list', {
      view: 'collection',
      collectionId: 'c',
      types: ['url'],
      sort: 'title',
      limit: 10,
      offset: 0
    })
    accepts('items:get', { id: 'x' })
    accepts('items:update', { id: 'x', patch: { title: 'T' } })
    accepts('items:trash', { ids: ['a', 'b'] })
    accepts('items:reprocess', { id: 'x', from: 'understand' })
    accepts('items:reprocessAll', {})
    accepts('capture:files', { paths: ['/tmp/a'], mode: 'reference' })
    accepts('capture:url', { url: 'https://example.com/a?b=1' })
    accepts('capture:text', { text: 'hello' })
    accepts('capture:blob', { name: 'a.png', mimeType: 'image/png', bytes: new ArrayBuffer(4) })
    accepts('capture:blob', { name: 'a.png', mimeType: 'image/png', bytes: new Uint8Array(4) })
    accepts('capture:drop', { files: [], uriList: 'https://a.b', text: 'https://a.b', source: 'shelf' })
    accepts('collections:list', undefined)
    accepts('collections:create', { name: 'N' })
    accepts('relationships:create', { sourceId: 'a', targetId: 'b', type: 'inspired_by' })
    accepts('search:quick', { query: 'minimax', limit: 20 })
    accepts('agent:command', { question: 'What am I researching?', itemIds: ['a'], template: 'compare' })
    accepts('agent:command', {
      question: 'follow-up',
      history: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'first answer' }
      ]
    })
    accepts('agent:undoRun', { runId: 'r1' })
    accepts('agent:applyProposals', { runId: 'r1' })
    accepts('system:revealLibrary', undefined)
    accepts('settings:update', {
      apiKey: 'k',
      ai: 'on',
      provider: 'gmi',
      theme: 'dark',
      baseUrl: 'https://api.gmi-serving.com/v1'
    })
    accepts('settings:get', undefined)
    accepts('system:contextMenu', { kind: 'items', ids: ['a', 'b'] })
    accepts('system:openExternal', { url: 'https://x.y' })
    accepts('jobs:status', undefined)
  })

  it('rejects invalid payloads', () => {
    rejects('items:list', { view: 'everything' })
    rejects('items:list', { view: 'library', extra: 1 })
    rejects('items:get', {})
    rejects('items:get', { id: '' })
    rejects('items:trash', { ids: [] })
    rejects('items:reprocess', { id: 'x', from: 'teleport' })
    rejects('capture:files', { paths: [] })
    rejects('capture:url', { url: 'ftp://example.com' })
    rejects('capture:url', { url: 'not a url' })
    rejects('capture:text', { text: '' })
    rejects('capture:blob', { name: 'a', mimeType: 'x', bytes: 'nope' })
    rejects('capture:drop', { files: [], source: 'email' })
    rejects('collections:create', { name: '' })
    rejects('relationships:create', { sourceId: 'a', targetId: 'b', type: 'friends_with' })
    rejects('agent:undoRun', {})
    rejects('agent:undoRun', { runId: '' })
    rejects('agent:command', {
      question: 'x',
      history: [{ role: 'system', content: 'oops' }]
    })
    rejects('agent:command', {
      question: 'x',
      history: [{ role: 'user' }]
    })
    rejects('agent:command', {
      question: 'x',
      history: Array.from({ length: 9 }, () => ({ role: 'user', content: 'x' }))
    })
    rejects('agent:applyProposals', { runId: 'r1', extra: true })
    rejects('system:revealLibrary', { path: '/tmp' })
    rejects('settings:update', { theme: 'sepia' })
    rejects('settings:update', { baseUrl: 'nope' })
    rejects('system:contextMenu', { kind: 'nope', ids: [] })
    rejects('system:openExternal', { url: 'javascript:alert(1)' })
    rejects('settings:get', { anything: 1 })
  })

  it('describes the first issue with its path', () => {
    const r = schemaFor('items:get').safeParse({ id: 42 })
    expect(r.success).toBe(false)
    if (!r.success) expect(describeIssues(r.error)).toMatch(/^id: /)
  })
})

describe('router', () => {
  type Listener = (event: { sender: { id: number } }, payload: unknown) => Promise<unknown>

  function setup(overrides: Partial<HandlerMap> = {}): {
    invoke: (channel: string, senderId: number, payload: unknown) => Promise<unknown>
  } {
    const listeners = new Map<string, Listener>()
    const stub = (): never => {
      throw new KaError('NOT_IMPLEMENTED', 'stub')
    }
    const handlers = Object.fromEntries(IPC_CHANNEL_LIST.map((c) => [c, stub])) as unknown as HandlerMap
    createRouter({
      handle: (channel, listener) => listeners.set(channel, listener),
      isKnownSender: (id) => id === 1,
      handlers: { ...handlers, ...overrides },
      logger: silentLogger
    })
    expect([...listeners.keys()].sort()).toEqual([...IPC_CHANNEL_LIST].sort())
    return {
      invoke: (channel, senderId, payload) => {
        const listener = listeners.get(channel)
        if (!listener) throw new Error(`no listener for ${channel}`)
        return listener({ sender: { id: senderId } }, payload)
      }
    }
  }

  it('rejects unknown senders before validating anything', async () => {
    const { invoke } = setup()
    await expect(invoke('system:stats', 99, undefined)).resolves.toEqual({
      ok: false,
      error: { code: 'VALIDATION', message: 'Unknown sender' }
    })
  })

  it('validates payloads and wraps handler results in the envelope', async () => {
    const { invoke } = setup({
      'items:get': async ({ id }) => ({ id }) as never,
      'system:stats': () => ({ items: 1, connections: 2, collections: 3, processing: 0, aiStatus: 'off' })
    })
    await expect(invoke('items:get', 1, { nope: true })).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    await expect(invoke('items:get', 1, { id: 'a' })).resolves.toEqual({ ok: true, data: { id: 'a' } })
    await expect(invoke('system:stats', 1, undefined)).resolves.toEqual({
      ok: true,
      data: { items: 1, connections: 2, collections: 3, processing: 0, aiStatus: 'off' }
    })
  })

  it('routes run-level undo and proposal approval through the handler', async () => {
    const calls: string[] = []
    const { invoke } = setup({
      'agent:undoRun': ({ runId }) => {
        calls.push(`undo:${runId}`)
        return { undone: 2 }
      },
      'agent:applyProposals': ({ runId }) => {
        calls.push(`apply:${runId}`)
        return { applied: 1, remaining: [] }
      },
      'system:revealLibrary': () => {
        calls.push('reveal')
      }
    })
    await expect(invoke('agent:undoRun', 1, { runId: 'r1' })).resolves.toEqual({ ok: true, data: { undone: 2 } })
    await expect(invoke('agent:applyProposals', 1, { runId: 'r1' })).resolves.toEqual({
      ok: true,
      data: { applied: 1, remaining: [] }
    })
    await expect(invoke('system:revealLibrary', 1, undefined)).resolves.toEqual({ ok: true, data: undefined })
    expect(calls).toEqual(['undo:r1', 'apply:r1', 'reveal'])
  })

  it('maps KaError codes and hides internal errors', async () => {
    const { invoke } = setup({
      'items:trash': () => {
        throw new KaError('NOT_FOUND', 'Gone.')
      },
      'collections:list': () => {
        throw new TypeError('secret internal detail')
      }
    })
    await expect(invoke('items:trash', 1, { ids: ['a'] })).resolves.toEqual({
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Gone.' }
    })
    const internal = (await invoke('collections:list', 1, undefined)) as {
      ok: boolean
      error: { code: string; message: string }
    }
    expect(internal.ok).toBe(false)
    expect(internal.error.code).toBe('INTERNAL')
    expect(internal.error.message).not.toContain('secret')
    await expect(invoke('search:quick', 1, { query: 'x' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_IMPLEMENTED' }
    })
  })
})

describe('event bridge', () => {
  it('forwards domain events to every live target as IPC events', () => {
    const sent: { channel: string; payload: unknown }[] = []
    const dead = { send: () => sent.push({ channel: 'dead', payload: null }), isDestroyed: () => true }
    const live = { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) }
    const bus = createEventBus()
    const push = createIpcPush(() => [dead, live])
    const off = bridgeDomainEvents(bus, push)
    bus.emit('item.created', { reason: 'created', ids: ['a'] })
    bus.emit('collections.changed', {})
    bus.emit('job.progress', {
      itemId: 'a',
      batchId: null,
      processingStatus: 'EXTRACTING',
      stage: 'extract',
      jobStatus: 'running',
      attempts: 1
    })
    expect(sent.map((s) => s.channel)).toEqual(['items:changed', 'collections:changed', 'jobs:progress'])
    off()
    bus.emit('collections.changed', {})
    expect(sent).toHaveLength(3)
  })
})

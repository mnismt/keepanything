import { join } from 'node:path'
import { app, ipcMain, protocol, utilityProcess } from 'electron'
import { MEDIA_SCHEME } from '../shared/constants'
import type { TestConnectionResult } from '../shared/ipc'
import { createAgentService } from './agent'
import { createAiProvider, createEmbeddingProvider } from './ai'
import { createIntake } from './capture/intake'
import { createAuditService } from './core/audit'
import { createCollectionService } from './core/collection-service'
import { isKaError } from './core/errors'
import { createEventBus } from './core/events'
import { createItemService } from './core/item-service'
import { createRelationshipService } from './core/relationship-service'
import { createDesktopActions } from './desktop/actions'
import { installActivation } from './desktop/activation'
import { installAppMenu } from './desktop/app-menu'
import { createPageFetcher } from './desktop/dom-fallback'
import { type DragWatcher, startDragWatch } from './desktop/drag-watch'
import { registerMediaProtocol } from './desktop/media-protocol'
import { registerShortcuts } from './desktop/shortcuts'
import { installTheme } from './desktop/theme'
import { createTray } from './desktop/tray'
import { createWindowManager } from './desktop/windows'
import { debugMode, e2eMode, envAiMode, isDev, loadDotEnv } from './env'
import { bridgeDomainEvents, createIpcPush } from './ipc/events'
import { createHandlers } from './ipc/handlers'
import { createRouter } from './ipc/router'
import { systemClock } from './lib/clock'
import { createConfig } from './lib/config'
import { createFileSink, createLogger, type LogSink, stderrSink } from './lib/logger'
import { readEnvDefaults } from './lib/settings'
import { createWorkerClient } from './lib/worker-client'
import { createQueue } from './pipeline/queue'
import { createScheduler, type Scheduler } from './pipeline/scheduler'
import { STAGES } from './pipeline/stages'
import { createStateApplier } from './pipeline/state'
import type { AIProvider, Logger, StageDeps } from './ports'
import { createSnapshotter } from './previews/snapshot'
import { createThumbnailer } from './previews/thumbnails'
import { createRetrieval } from './retrieval'
import { denyUnexpectedWebContents, installContentSecurityPolicy } from './security'
import { type Db, openDatabase } from './storage/db'
import { createObjectStore } from './storage/object-store'
import { buildPaths, ensureLibraryDirs } from './storage/paths'
import { createRepositories } from './storage/repositories'

/**
 * Bootstrap: scheme registration -> dev userData -> single instance -> whenReady ->
 * config -> db + migrate -> services -> worker client -> windows -> tray + shelf -> ipc -> menu ->
 * activation -> scheduler. Shutdown: scheduler stop -> worker terminate -> db close.
 */

// Must run before `app.whenReady()`.
protocol.registerSchemesAsPrivileged([
  { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

// Dev and packaged builds never share a library; test runs get a throwaway profile.
if (e2eMode) {
  app.setPath('userData', join(app.getPath('temp'), 'keepanything-e2e'))
} else if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('userData'), 'dev'))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
}

loadDotEnv()

let isQuitting = false
let shutdownComplete = false
let shutdown: (() => Promise<void>) | null = null

async function bootstrap(): Promise<void> {
  // Packaged: `<resources>/models`; unpackaged (dev, E2E): the fetched `build/models` in the repo.
  const paths = buildPaths(
    app.getPath('userData'),
    app.isPackaged ? join(process.resourcesPath, 'models') : join(app.getAppPath(), 'build/models')
  )
  ensureLibraryDirs(paths)

  const envDefaults = readEnvDefaults(process.env)
  const fileSink = createFileSink(paths.logsDir)
  const sinks: LogSink[] = isDev || e2eMode ? [stderrSink, fileSink] : [fileSink]
  const logger: Logger = createLogger({
    level: debugMode ? 'debug' : 'info',
    sinks,
    secrets: envDefaults.apiKey ? [envDefaults.apiKey] : []
  })
  logger.info('starting', {
    version: app.getVersion(),
    userData: paths.userData,
    dev: isDev,
    e2e: e2eMode
  })

  const envMode = envAiMode()
  const settings = createConfig(paths, envMode ? { ...envDefaults, aiMode: envMode } : envDefaults, logger)

  const db: Db = openDatabase(paths.dbFile)
  db.migrate()
  logger.info('database ready', { schemaVersion: db.schemaVersion() })

  const clock = systemClock
  const repos = createRepositories(db)
  const events = createEventBus(logger)
  const audit = createAuditService({ db, repos, events, clock })
  const queue = createQueue({ jobs: repos.jobs, clock })
  const items = createItemService({ db, repos, events, clock, audit, pipeline: queue })
  const collections = createCollectionService({ db, repos, events, clock, audit })
  const relationships = createRelationshipService({ db, repos, events, clock, audit })
  const objectStore = createObjectStore(paths)

  const worker = createWorkerClient({
    fork: () => utilityProcess.fork(join(__dirname, 'worker.js'), [], { serviceName: 'keepanything-worker' }),
    logger: logger.child({ scope: 'worker' })
  })
  const pageFetcher = createPageFetcher(logger.child({ scope: 'fetch' }))
  const thumbnailer = createThumbnailer(logger.child({ scope: 'thumbs' }))
  const snapshotter = createSnapshotter(logger.child({ scope: 'snapshot' }))

  // The reasoning provider depends on key/mode/model, so it is rebuilt on every
  // settings change; stages and handlers read it through the shared, mutable `stageDeps` object.
  const buildAi = (): AIProvider => {
    const current = settings.get()
    return createAiProvider({
      mode: current.aiMode,
      apiKey: settings.apiKey(),
      baseUrl: current.baseUrl,
      model: current.model,
      logger,
      clock
    })
  }
  const embeddings = createEmbeddingProvider({
    worker,
    modelsDir: paths.modelsDir,
    ...(paths.resourcesModelsDir ? { resourcesModelsDir: paths.resourcesModelsDir } : {}),
    logger
  })
  const reportEmbeddings = (): void =>
    settings.setEmbeddingsStatus({
      provider: embeddings.backend(),
      modelPresent: embeddings.modelPresent(),
      dims: embeddings.dims
    })
  const stageDeps: StageDeps = {
    worker,
    events,
    pageFetcher,
    thumbnailer,
    snapshotter,
    objectStore,
    ai: buildAi(),
    embeddings,
    repos: repos as unknown as Record<string, unknown>
  }
  // Retrieval + agent; stages also get the services they mutate through (audit rows).
  const retrieval = createRetrieval({ db, repos, embeddings, logger, clock })
  const agent = createAgentService({
    db,
    repos,
    retrieval,
    ai: () => stageDeps.ai as AIProvider,
    items,
    collections,
    relationships,
    audit,
    events,
    clock,
    logger,
    paths,
    objectStore,
    queue
  })
  Object.assign(stageDeps, { retrieval, agent, collections, relationships, queue })

  const state = createStateApplier({ db, repos, queue, clock, logger })
  const scheduler: Scheduler = createScheduler({
    db,
    repos,
    queue,
    state,
    stages: STAGES,
    deps: stageDeps,
    paths,
    logger: logger.child({ scope: 'scheduler' }),
    clock,
    events
  })
  const intake = createIntake({
    db,
    items,
    collections,
    pipeline: queue,
    objectStore,
    settings: () => settings.get(),
    clock,
    logger: logger.child({ scope: 'intake' }),
    worker
  })

  installContentSecurityPolicy()
  denyUnexpectedWebContents()
  registerMediaProtocol(paths, logger.child({ scope: 'media' }))

  const windows = createWindowManager({ isQuitting: () => isQuitting, logger })
  const push = createIpcPush(() => windows.webContents(), logger)
  bridgeDomainEvents(events, push)
  installTheme(settings, push)

  const syncAiLane = (): void => {
    if (settings.aiStatus() === 'off' || settings.aiStatus() === 'unconfigured') scheduler.pauseAi()
    else scheduler.resumeAi()
  }
  settings.onChange((current) => {
    stageDeps.ai = buildAi()
    events.emit('settings.changed', { settings: current })
    syncAiLane()
  })

  /** `settings:testConnection`: one tiny completion against the configured provider. */
  const testConnection = async (): Promise<TestConnectionResult> => {
    const ai = stageDeps.ai as AIProvider
    const started = Date.now()
    try {
      const response = await ai.chat({
        messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
        maxTokens: 16,
        timeoutMs: 20_000,
        task: 'test_connection'
      })
      settings.setAiStatus(null)
      return { ok: true, model: response.model, latencyMs: Date.now() - started }
    } catch (error) {
      const message = isKaError(error) ? error.message : "Couldn't reach the provider."
      if (isKaError(error) && (error.code === 'OFFLINE' || error.code === 'AI_UNAVAILABLE'))
        settings.setAiStatus('offline')
      return { ok: false, model: ai.model, latencyMs: Date.now() - started, error: message }
    }
  }

  const desktop = createDesktopActions(windows, repos)
  const handlers = createHandlers({
    items,
    collections,
    relationships,
    audit,
    repos,
    queue,
    settings,
    objectStore,
    paths,
    clock,
    logger: logger.child({ scope: 'ipc' }),
    desktop,
    push,
    intake,
    retrieval,
    agent,
    ai: () => stageDeps.ai as AIProvider,
    embeddings,
    testConnection,
    onSettingsChanged: syncAiLane
  })
  createRouter({
    handle: (channel, listener) => ipcMain.handle(channel, (event, payload: unknown) => listener(event, payload)),
    isKnownSender: windows.isKnownSender,
    handlers,
    logger: logger.child({ scope: 'ipc' })
  })

  const captureFiles = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return
    await intake.captureFiles(paths, undefined, { source: 'dialog' })
  }
  installAppMenu({
    showLibrary: () => void windows.showLibrary(),
    toggleShelf: () => windows.toggleShelf(),
    addFiles: async () => {
      const chosen = await desktop.chooseFiles()
      await captureFiles(chosen)
    }
  })
  /** Files or text dropped straight onto the menu-bar icon; the shelf shows the receipt. */
  const keepDropped = async (payload: { files?: string[]; text?: string }): Promise<void> => {
    windows.noteShelfDrop()
    const request = {
      files: payload.files ?? [],
      source: 'shelf' as const,
      ...(payload.text ? { text: payload.text } : {})
    }
    if (request.files.length === 0 && !request.text) return
    const result = await intake.captureDrop(request)
    push.send('shelf:dropped', { result })
  }
  const tray = createTray(
    {
      toggleShelf: () => windows.toggleShelf(),
      showLibrary: () => void windows.showLibrary(),
      hideShelf: () => windows.hideShelf(),
      armShelf: () => windows.armShelf(),
      disarmShelf: () => windows.disarmShelf(),
      keepDropped: (payload) =>
        void keepDropped(payload).catch((error: unknown) => logger.warn('tray drop failed', { error })),
      quit: () => app.quit()
    },
    logger.child({ scope: 'tray' })
  )
  const unregisterShortcuts = registerShortcuts({ toggleShelf: () => windows.toggleShelf() }, logger)
  installActivation({ showLibrary: () => void windows.showLibrary(), captureFiles }, logger)

  // Global drag detection: the shelf appears while the user drags, instead of after a click they
  // cannot make with a file in hand. Packaged: `<resources>/native`; dev: the compiled `build/native`.
  // Off under E2E, where someone dragging a file on the test machine would open a second window
  // mid-assertion.
  const dragWatch: DragWatcher = e2eMode
    ? { running: () => false, stop: () => {} }
    : startDragWatch(
        join(
          app.isPackaged ? join(process.resourcesPath, 'native') : join(app.getAppPath(), 'build/native'),
          'ka-drag-watch'
        ),
        { onDragStart: () => windows.armShelf(), onDragEnd: () => windows.disarmShelf() },
        logger.child({ scope: 'drag' })
      )

  windows.showLibrary()
  // The shelf has to exist before the first drag: a window born mid-drag is not a drop target yet.
  windows.prewarmShelf()
  syncAiLane()
  scheduler.start()
  reportEmbeddings()
  void embeddings
    .ready()
    .then(reportEmbeddings, (error: unknown) => logger.warn('embeddings warm-up failed', { error }))
  void retrieval
    .warm()
    .then(() => {
      // Items embedded with the hashed fallback are re-embedded once the real model is available.
      if (embeddings.id === 'local-hash') return
      const stale = retrieval.staleEmbeddingItemIds()
      for (const id of stale) items.reprocess(id, 'embed')
      if (stale.length > 0) logger.info('re-embedding items from an older model', { count: stale.length })
    })
    .catch((error: unknown) => logger.warn('retrieval warm-up failed', { error }))
  logger.info('ready')

  shutdown = async () => {
    logger.info('shutting down')
    unregisterShortcuts()
    dragWatch.stop()
    tray.destroy()
    await scheduler.stop()
    pageFetcher.dispose()
    snapshotter.dispose()
    worker.terminate()
    windows.destroyAll()
    db.close()
    fileSink.close()
  }
}

app.whenReady().then(() =>
  bootstrap().catch((error: unknown) => {
    process.stderr.write(
      `KeepAnything failed to start: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    )
    app.exit(1)
  })
)

app.on('before-quit', () => {
  isQuitting = true
})

app.on('will-quit', (event) => {
  if (shutdownComplete || !shutdown) return
  event.preventDefault()
  const run = shutdown
  shutdown = null
  run()
    .catch((error: unknown) =>
      process.stderr.write(`shutdown error: ${error instanceof Error ? error.message : String(error)}\n`)
    )
    .finally(() => {
      shutdownComplete = true
      // Must be a macrotask: a microtask would run while Electron's first quit sequence is still on
      // the native stack (with its quitting flag set), making this second `quit()` a no-op.
      setImmediate(() => app.quit())
    })
})

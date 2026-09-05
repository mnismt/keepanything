import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTray } from '../../src/main/desktop/tray'
import type { Logger } from '../../src/main/ports'

type Bounds = { x: number; y: number; width: number; height: number }
type TrayListener = (event: unknown, bounds?: Bounds) => void

// `vi.mock` factories are hoisted, so the values they reference must be inlined or declared
// above the factory call. The test state (handlers map, FakeTray instances) lives in module
// scope so assertions can drive the registered listeners.
const handlers = new Map<string, TrayListener[]>()

// The tray PNGs are bundled by Vite via `?asset`. Vitest can't resolve that query, so stub the
// `readFileSync` calls those imports generate.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    readFileSync: () => Buffer.from([0])
  }
})

vi.mock('electron', () => {
  class FakeTray {
    static instances: FakeTray[] = []
    setToolTip = () => {}
    destroy = () => {}
    popUpContextMenu = () => {}
    on(event: string, listener: TrayListener): FakeTray {
      const list = handlers.get(event) ?? []
      list.push(listener)
      handlers.set(event, list)
      return this
    }
    constructor() {
      FakeTray.instances.push(this)
    }
  }

  class FakeImage {
    static instances: FakeImage[] = []
    setTemplateImage = () => {}
    addRepresentation = () => {}
  }

  return {
    Tray: FakeTray,
    nativeImage: {
      createEmpty: () => new FakeImage()
    },
    screen: {
      getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
    },
    Menu: {
      buildFromTemplate: () => ({ fake: 'menu' })
    }
  }
})

const plausibleBounds: Bounds = { x: 100, y: 10, width: 22, height: 22 }

const fakeLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child() {
    return this
  }
}

const dispatch = (event: string, bounds: Bounds = plausibleBounds): void => {
  const list = handlers.get(event)
  if (!list) throw new Error(`no handlers registered for ${event}`)
  for (const listener of list) listener({}, bounds)
}

const buildActions = () => ({
  toggleShelf: vi.fn(),
  showLibrary: vi.fn(),
  hideShelf: vi.fn(),
  armShelf: vi.fn(),
  disarmShelf: vi.fn(),
  keepDropped: vi.fn(),
  quit: vi.fn()
})

beforeEach(() => {
  handlers.clear()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('createTray', () => {
  it('toggles the shelf on a single click', () => {
    const actions = buildActions()
    createTray(actions, fakeLogger)

    dispatch('click')

    expect(actions.toggleShelf).toHaveBeenCalledTimes(1)
    expect(actions.hideShelf).not.toHaveBeenCalled()
    expect(actions.showLibrary).not.toHaveBeenCalled()
  })

  it('hides the shelf and opens the library on double-click', () => {
    const actions = buildActions()
    createTray(actions, fakeLogger)

    dispatch('double-click')

    expect(actions.hideShelf).toHaveBeenCalledTimes(1)
    expect(actions.showLibrary).toHaveBeenCalledTimes(1)
    // showLibrary must come after hideShelf so the shelf closes before the library takes focus.
    const hideOrder = actions.hideShelf.mock.invocationCallOrder[0]
    const showOrder = actions.showLibrary.mock.invocationCallOrder[0]
    expect(hideOrder).toBeLessThan(showOrder ?? -1)
    expect(actions.toggleShelf).not.toHaveBeenCalled()
  })

  it('single click then double click: shelf ends hidden, library shown, toggle fires only once', () => {
    const actions = buildActions()
    createTray(actions, fakeLogger)

    dispatch('click')
    dispatch('double-click')

    expect(actions.toggleShelf).toHaveBeenCalledTimes(1)
    expect(actions.hideShelf).toHaveBeenCalledTimes(1)
    expect(actions.showLibrary).toHaveBeenCalledTimes(1)
  })
})

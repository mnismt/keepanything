import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KaError } from '../../src/main/core/errors'
import type { Understanding } from '../../src/shared/types'
import { createHarness, type Harness } from './helpers/harness'

let h: Harness

beforeEach(() => {
  h = createHarness()
})
afterEach(() => h.close())

const understanding: Understanding = {
  kind: 'article',
  title: 'Model title',
  summary: 'Model summary',
  whyUseful: 'Model why',
  topics: ['t1'],
  entities: ['e1'],
  visualDescription: 'dark page',
  retrievalHints: ['hint'],
  confidence: 0.9
}

describe('item service', () => {
  it('creates items at CAPTURED and emits item.created after commit', () => {
    const item = h.item({ title: '  Hello  ' })
    expect(item.title).toBe('Hello')
    expect(item.processingStatus).toBe('CAPTURED')
    const created = h.eventsNamed('item.created')
    expect(created).toHaveLength(1)
    expect(created[0]?.summaries?.[0]?.id).toBe(item.id)
  })

  it('user edits set overrides, audit and an index job; the agent then skips those fields', () => {
    const item = h.item({ type: 'markdown', title: 'Original' })
    const detail = h.items.updateByUser(item.id, { title: 'Mine', understanding: 'My understanding' })
    expect(detail.item.title).toBe('Mine')
    expect(detail.item.userOverrides).toEqual({ title: true, understanding: true })
    expect(h.repos.jobs.activeForItem(item.id).map((j) => j.stage)).toEqual(['index'])
    expect(h.repos.audit.forEntity('item', item.id)[0]).toMatchObject({ actor: 'user', action: 'update_item' })

    const applied = h.items.applyUnderstanding(item.id, understanding, { agentRunId: 'run-1' })
    expect(applied.skippedFields).toEqual(['title', 'understanding'])
    expect(applied.item.title).toBe('Mine')
    expect(applied.item.understanding).toBe('My understanding')
    expect(applied.item.whyUseful).toBe('Model why')
    expect(applied.item.kind).toBe('article')
    expect(applied.item.topics).toEqual(['t1'])
    expect(applied.item.visionText).toBe('dark page')
    expect(applied.item.retrievalHints).toEqual(['hint'])
    expect(applied.item.aiConfidence).toBe(0.9)
    expect(h.repos.audit.forEntity('item', item.id)[0]).toMatchObject({
      actor: 'agent',
      action: 'update_understanding',
      agentRunId: 'run-1'
    })
  })

  it('rejects empty titles and unknown ids with KaError codes', () => {
    const item = h.item()
    expect(() => h.items.updateByUser(item.id, { title: '   ' })).toThrow(KaError)
    try {
      h.items.get('nope')
    } catch (error) {
      expect(error).toMatchObject({ code: 'NOT_FOUND' })
    }
  })

  it('trash cancels jobs and hides the item; restore brings it back; both are audited and undoable', () => {
    const item = h.item()
    h.queue.enqueueInitial(item)
    expect(h.repos.jobs.activeForItem(item.id).length).toBeGreaterThan(0)
    h.items.trash([item.id])
    expect(h.repos.jobs.activeForItem(item.id)).toEqual([])
    expect(h.repos.items.get(item.id)?.deletedAt).not.toBeNull()
    expect(h.eventsNamed('item.trashed')).toHaveLength(1)
    const trashAudit = h.repos.audit.forEntity('item', item.id)[0]
    expect(trashAudit?.action).toBe('trash_item')
    h.audit.undo(trashAudit?.id ?? '')
    expect(h.repos.items.get(item.id)?.deletedAt).toBeNull()
    h.items.trash([item.id])
    h.items.restore([item.id])
    expect(h.repos.items.get(item.id)?.deletedAt).toBeNull()
    expect(h.eventsNamed('item.restored')).toHaveLength(2)
  })

  it('deleteForever removes folder children too and cascades memberships/relationships', () => {
    const folder = h.item({ type: 'folder' })
    const child = h.item({ parentItemId: folder.id })
    const other = h.item()
    h.relationships.create({ sourceId: child.id, targetId: other.id, type: 'references', createdBy: 'user' })
    const removed = h.items.deleteForever([folder.id])
    expect(removed.map((i) => i.id).sort()).toEqual([folder.id, child.id].sort())
    expect(h.repos.items.get(child.id)).toBeNull()
    expect(h.repos.relationships.forItem(other.id)).toEqual([])
    expect(h.eventsNamed('item.deleted')[0]?.ids).toHaveLength(2)
  })

  it('reprocess resets the status per stage and enqueues from there', () => {
    const item = h.item({ type: 'url', processingStatus: 'READY', url: 'https://a.b' })
    h.items.reprocess(item.id, 'understand')
    expect(h.repos.items.get(item.id)?.processingStatus).toBe('EXTRACTED')
    expect(h.repos.jobs.activeForItem(item.id).map((j) => j.stage)).toEqual(['understand'])
    h.items.reprocess(item.id)
    expect(h.repos.items.get(item.id)?.processingStatus).toBe('CAPTURED')
    expect(
      h.repos.jobs
        .activeForItem(item.id)
        .map((j) => j.stage)
        .sort()
    ).toEqual(['extract', 'snapshot'])
    expect(h.items.reprocessAll('index')).toBe(1)
  })

  it('builds item detail with relationships, collections and children', () => {
    const folder = h.item({ type: 'folder', title: 'F' })
    const child = h.item({ parentItemId: folder.id })
    const other = h.item({ title: 'Other' })
    h.relationships.create({
      sourceId: other.id,
      targetId: folder.id,
      type: 'inspired_by',
      createdBy: 'agent',
      agentRunId: 'r'
    })
    const c = h.collections.create({ name: 'Set', createdBy: 'agent' })
    h.collections.addItems(c.id, [{ itemId: folder.id, reason: 'because', confidence: 0.5 }], {
      actor: 'agent',
      agentRunId: 'r'
    })
    const detail = h.items.detail(folder.id)
    expect(detail.relationships).toHaveLength(1)
    expect(detail.relationships[0]).toMatchObject({ direction: 'in', label: 'inspired', other: { id: other.id } })
    expect(detail.collections[0]).toMatchObject({ id: c.id, reason: 'because', addedBy: 'agent', agentRunId: 'r' })
    expect(detail.children?.map((s) => s.id)).toEqual([child.id])
    expect(detail.summary.childCount).toBe(1)
  })

  it('keptAgain bumps last_kept_at and audits', () => {
    const item = h.item()
    h.clock.advance(60_000)
    const bumped = h.items.keptAgain(item.id)
    expect(bumped.lastKeptAt).toBe(h.clock.nowIso())
    expect(h.repos.audit.forEntity('item', item.id)[0]?.action).toBe('kept_again')
  })
})

describe('collection service', () => {
  it('validates names and refuses duplicates (normalized)', () => {
    h.collections.create({ name: 'Reading List', createdBy: 'user' })
    expect(() => h.collections.create({ name: '  reading-list ', createdBy: 'agent' })).toThrow(/already exists/)
    expect(() => h.collections.create({ name: '   ', createdBy: 'user' })).toThrow(/name/)
    expect(h.eventsNamed('collections.changed')).toHaveLength(1)
  })

  it('agents cannot rename user collections; users can; renames are undoable', () => {
    const c = h.collections.create({ name: 'Mine', createdBy: 'user' })
    expect(() => h.collections.rename(c.id, 'Theirs', undefined, { actor: 'agent' })).toThrow(KaError)
    h.collections.rename(c.id, 'Renamed', 'desc', { actor: 'user' })
    expect(h.repos.collections.get(c.id)).toMatchObject({ name: 'Renamed', nameKey: 'renamed', description: 'desc' })
    const audit = h.repos.audit.forEntity('collection', c.id)[0]
    h.audit.undo(audit?.id ?? '')
    expect(h.repos.collections.get(c.id)?.name).toBe('Mine')
  })

  it('user removal writes both suppression keys and the agent is refused afterwards', () => {
    const c = h.collections.create({ name: 'Research', createdBy: 'agent' })
    const item = h.item()
    expect(h.collections.addItems(c.id, [{ itemId: item.id }, { itemId: 'ghost' }], { actor: 'agent' })).toEqual({
      added: [item.id],
      skipped: [{ itemId: 'ghost', reason: 'missing' }]
    })
    h.collections.removeItem(c.id, item.id, { actor: 'user' })
    expect(h.repos.suppressions.has('collection_member', `${c.id}:${item.id}`)).toBe(true)
    expect(h.repos.suppressions.has('collection_member', `name:research:${item.id}`)).toBe(true)
    expect(h.collections.addItems(c.id, [{ itemId: item.id }], { actor: 'agent' })).toEqual({
      added: [],
      skipped: [{ itemId: item.id, reason: 'suppressed' }]
    })
    // The user re-adding clears the suppression.
    expect(h.collections.addItems(c.id, [{ itemId: item.id }], { actor: 'user' }).added).toEqual([item.id])
    expect(h.repos.suppressions.has('collection_member', `${c.id}:${item.id}`)).toBe(false)
    expect(h.collections.addItems(c.id, [{ itemId: item.id }], { actor: 'user' }).skipped[0]?.reason).toBe('exists')
  })

  it('undoing an agent add removes the member and suppresses it; undo twice is a conflict', () => {
    const c = h.collections.create({ name: 'Set', createdBy: 'agent' })
    const item = h.item()
    h.collections.addItems(c.id, [{ itemId: item.id }], { actor: 'agent', agentRunId: 'run' })
    const entry = h.repos.audit.forRun('run')[0]
    h.audit.undo(entry?.id ?? '')
    expect(h.repos.collections.getMember(c.id, item.id)).toBeNull()
    expect(h.repos.suppressions.has('collection_member', `${c.id}:${item.id}`)).toBe(true)
    expect(() => h.audit.undo(entry?.id ?? '')).toThrow(/Already undone/)
    expect(() => h.audit.undo('missing')).toThrow(KaError)
  })

  it('deleting a collection is undoable with its members', () => {
    const c = h.collections.create({ name: 'Set', createdBy: 'user' })
    const item = h.item()
    h.collections.addItems(c.id, [{ itemId: item.id }], { actor: 'user' })
    h.collections.delete(c.id, { actor: 'user' })
    expect(h.repos.collections.get(c.id)).toBeNull()
    const entry = h.repos.audit.forEntity('collection', c.id)[0]
    h.audit.undo(entry?.id ?? '')
    expect(h.repos.collections.get(c.id)?.name).toBe('Set')
    expect(h.repos.collections.getMember(c.id, item.id)).not.toBeNull()
  })

  it('user removeItem suppresses future agent adds for that pair', () => {
    const c = h.collections.create({ name: 'Set', createdBy: 'user' })
    const item = h.item()
    h.collections.addItems(c.id, [{ itemId: item.id }], { actor: 'agent' })
    h.collections.removeItem(c.id, item.id, { actor: 'user' })
    const result = h.collections.addItems(c.id, [{ itemId: item.id }], { actor: 'agent' })
    expect(result.added).toEqual([])
    expect(result.skipped).toEqual([{ itemId: item.id, reason: 'suppressed' }])
    // user actor clears the suppression, allowing the add again
    const retry = h.collections.addItems(c.id, [{ itemId: item.id }], { actor: 'user' })
    expect(retry.added).toEqual([item.id])
  })
})

describe('relationship service', () => {
  it('normalizes symmetric pairs, refuses self links, duplicates and suppressed agent facts', () => {
    const a = h.item()
    const b = h.item()
    expect(() =>
      h.relationships.create({ sourceId: a.id, targetId: a.id, type: 'related_to', createdBy: 'user' })
    ).toThrow(/itself/)
    const r = h.relationships.create({ sourceId: b.id, targetId: a.id, type: 'related_to', createdBy: 'agent' })
    expect(r.sourceItemId < r.targetItemId).toBe(true)
    expect(() =>
      h.relationships.create({ sourceId: a.id, targetId: b.id, type: 'related_to', createdBy: 'agent' })
    ).toThrow(/Already/)
    h.relationships.remove(r.id, { actor: 'user' })
    expect(() =>
      h.relationships.create({ sourceId: a.id, targetId: b.id, type: 'inspired_by', createdBy: 'agent' })
    ).toThrow(/removed/)
    // The user may recreate it, which clears the suppression.
    const again = h.relationships.create({ sourceId: a.id, targetId: b.id, type: 'inspired_by', createdBy: 'user' })
    expect(h.relationships.isSuppressed(a.id, b.id)).toBe(false)
    expect(h.relationships.forItem(b.id)[0]).toMatchObject({ direction: 'in', label: 'inspired', otherId: a.id })
    expect(h.relationships.get(again.id).type).toBe('inspired_by')
  })

  it('undoing an agent relationship deletes it and suppresses the pair', () => {
    const a = h.item()
    const b = h.item()
    const r = h.relationships.create({
      sourceId: a.id,
      targetId: b.id,
      type: 'references',
      createdBy: 'agent',
      agentRunId: 'run'
    })
    const entry = h.repos.audit.forRun('run')[0]
    h.audit.undo(entry?.id ?? '')
    expect(h.repos.relationships.get(r.id)).toBeNull()
    expect(h.relationships.isSuppressed(a.id, b.id)).toBe(true)
  })
})

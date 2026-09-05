import { describe, expect, it } from 'vitest'
import { MEDIA_ROOTS, parseMediaUrl, toMediaUrl } from '../../src/shared/media'

describe('toMediaUrl', () => {
  it('encodes each path segment and appends the version', () => {
    expect(toMediaUrl('thumbs', 'abc.png', 1)).toBe('ka-media://local/thumbs/abc.png?v=1')
    expect(toMediaUrl('objects', 'item-1/My File (final).pdf', 3)).toBe(
      'ka-media://local/objects/item-1/My%20File%20(final).pdf?v=3'
    )
    expect(toMediaUrl('content', 'note.md', 0)).toBe('ka-media://local/content/note.md?v=0')
  })

  it('handles unicode, drops empty segments and clamps odd versions', () => {
    expect(toMediaUrl('objects', 'x/Résumé – 2026.pdf', 2)).toBe(
      'ka-media://local/objects/x/R%C3%A9sum%C3%A9%20%E2%80%93%202026.pdf?v=2'
    )
    expect(toMediaUrl('snapshots', 'a//b.jpg', 1)).toBe('ka-media://local/snapshots/a/b.jpg?v=1')
    expect(toMediaUrl('snapshots', '/leading/slash.jpg', 1)).toBe('ka-media://local/snapshots/leading/slash.jpg?v=1')
    expect(toMediaUrl('thumbs', 'a.png', -4)).toBe('ka-media://local/thumbs/a.png?v=0')
    expect(toMediaUrl('thumbs', 'a.png', 2.9)).toBe('ka-media://local/thumbs/a.png?v=2')
  })
})

describe('parseMediaUrl', () => {
  it('round-trips what toMediaUrl produces, including spaces and unicode', () => {
    for (const root of MEDIA_ROOTS) {
      for (const rel of ['a.png', 'item 1/My File (final).pdf', 'x/Résumé – 2026.pdf', 'deep/er/path/文件.md']) {
        expect(parseMediaUrl(toMediaUrl(root, rel, 7))).toEqual({ root, relPath: rel, version: 7 })
      }
    }
  })

  it('defaults the version to 0 and ignores fragments', () => {
    expect(parseMediaUrl('ka-media://local/thumbs/a.png')).toEqual({ root: 'thumbs', relPath: 'a.png', version: 0 })
    expect(parseMediaUrl('ka-media://local/thumbs/a.png?v=4#x')).toEqual({
      root: 'thumbs',
      relPath: 'a.png',
      version: 4
    })
    expect(parseMediaUrl('ka-media://local/thumbs/a.png?other=1&v=9')).toEqual({
      root: 'thumbs',
      relPath: 'a.png',
      version: 9
    })
  })

  it('rejects unknown schemes, hosts and roots', () => {
    expect(parseMediaUrl('file:///etc/passwd')).toBeNull()
    expect(parseMediaUrl('ka-media://remote/thumbs/a.png')).toBeNull()
    expect(parseMediaUrl('ka-media://local/models/a.onnx')).toBeNull()
    expect(parseMediaUrl('ka-media://local/library.db')).toBeNull()
    expect(parseMediaUrl('ka-media://local/')).toBeNull()
  })

  it('rejects empty paths, traversal, backslashes and absolute paths', () => {
    expect(parseMediaUrl('ka-media://local/thumbs')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/../library.db')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/%2e%2e/library.db')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/a/./b.png')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs//etc/passwd')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/%2Fetc%2Fpasswd')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/a\\b.png')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/a%5Cb.png')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/a%00.png')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/%E0%A4%A.png')).toBeNull()
    expect(parseMediaUrl('ka-media://local/thumbs/a.png?v=abc')).toBeNull()
  })
})

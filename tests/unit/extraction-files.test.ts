import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { deflateRawSync } from 'node:zlib'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { folderMetadataFrom, renderTree, scanFolder } from '../../src/main/capture/folder'
import {
  archiveExtractor,
  archiveFormat,
  listTar,
  listZip,
  officeExtractor,
  readZipEntry,
  xmlToText
} from '../../src/main/extraction/archive'
import { chooseSamples, folderExtractor } from '../../src/main/extraction/folder'
import { extractorFor, opaqueExtractor } from '../../src/main/extraction/registry'
import {
  detectDelimiter,
  extractDelimited,
  splitCsvLine,
  spreadsheetExtractor
} from '../../src/main/extraction/spreadsheet'
import { createManualClock } from '../../src/main/lib/clock'
import { silentLogger } from '../../src/main/lib/logger'
import { fakeItem } from './helpers/fake-item'

const FOLDER = resolve(__dirname, '../fixtures/corpus/files/folder-serving-benchmark')
const deps = { logger: silentLogger, clock: createManualClock() }

/** Build a stored/deflated zip in memory (enough for the central-directory parser). */
function buildZip(entries: { name: string; data: string; deflate?: boolean }[]): Uint8Array {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  const le16 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff]
  const le32 = (n: number): number[] => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >>> 24) & 0xff]
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name)
    const raw = new TextEncoder().encode(e.data)
    const body = e.deflate ? new Uint8Array(deflateRawSync(raw)) : raw
    const method = e.deflate ? 8 : 0
    const local = new Uint8Array([
      0x50,
      0x4b,
      0x03,
      0x04,
      ...le16(20),
      ...le16(0),
      ...le16(method),
      ...le16(0),
      ...le16(0),
      ...le32(0),
      ...le32(body.length),
      ...le32(raw.length),
      ...le16(name.length),
      ...le16(0),
      ...name
    ])
    parts.push(local, body)
    central.push(
      new Uint8Array([
        0x50,
        0x4b,
        0x01,
        0x02,
        ...le16(20),
        ...le16(20),
        ...le16(0),
        ...le16(method),
        ...le16(0),
        ...le16(0),
        ...le32(0),
        ...le32(body.length),
        ...le32(raw.length),
        ...le16(name.length),
        ...le16(0),
        ...le16(0),
        ...le16(0),
        ...le16(0),
        ...le32(0),
        ...le32(offset),
        ...name
      ])
    )
    offset += local.length + body.length
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array([
    0x50,
    0x4b,
    0x05,
    0x06,
    ...le16(0),
    ...le16(0),
    ...le16(entries.length),
    ...le16(entries.length),
    ...le32(cdSize),
    ...le32(offset),
    ...le16(0)
  ])
  const total = [...parts, ...central, eocd]
  const out = new Uint8Array(total.reduce((n, p) => n + p.length, 0))
  let pos = 0
  for (const p of total) {
    out.set(p, pos)
    pos += p.length
  }
  return out
}

/** Build an uncompressed tar with the given files. */
function buildTar(entries: { name: string; data: string }[]): Uint8Array {
  const blocks: Uint8Array[] = []
  for (const e of entries) {
    const header = new Uint8Array(512)
    const enc = new TextEncoder()
    header.set(enc.encode(e.name).subarray(0, 100), 0)
    header.set(enc.encode('0000644\0'), 100)
    header.set(enc.encode(`${e.data.length.toString(8).padStart(11, '0')}\0`), 124)
    header[156] = 48
    header.set(enc.encode('ustar\0'), 257)
    let sum = 0
    for (let i = 0; i < 512; i += 1) sum += i >= 148 && i < 156 ? 32 : (header[i] ?? 0)
    header.set(enc.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148)
    blocks.push(header)
    const data = new Uint8Array(Math.ceil(e.data.length / 512) * 512)
    data.set(enc.encode(e.data))
    blocks.push(data)
  }
  blocks.push(new Uint8Array(1024))
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0))
  let pos = 0
  for (const b of blocks) {
    out.set(b, pos)
    pos += b.length
  }
  return out
}

describe('folder scan + adapter', () => {
  it('scans the demo folder with counts, extensions and a tree', async () => {
    const scan = await scanFolder(FOLDER)
    expect(scan.fileCount).toBe(6)
    expect(scan.dirCount).toBe(0)
    expect(scan.truncated).toBe(false)
    expect(scan.extensions).toMatchObject({ py: 1, md: 1, csv: 1, yaml: 1, txt: 1, jsonl: 1 })
    expect(scan.topLevel.map((e) => e.name)).toContain('README.md')
    const meta = folderMetadataFrom(scan)
    expect(meta).toMatchObject({ fileCount: 6, totalBytes: scan.totalBytes, truncated: false })
    expect(renderTree(scan, 'bench')).toContain('  run_bench.py')
    const { readme, samples } = chooseSamples(scan)
    expect(readme).toBe('README.md')
    expect(samples).toContain('notes.txt')
    expect(samples).not.toContain('README.md')
  })

  it('respects caps and skips build directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ka-folder-'))
    try {
      mkdirSync(join(root, 'node_modules', 'x'), { recursive: true })
      writeFileSync(join(root, 'node_modules', 'x', 'index.js'), 'ignored')
      mkdirSync(join(root, 'a', 'b', 'c', 'd', 'e'), { recursive: true })
      for (let i = 0; i < 12; i += 1) writeFileSync(join(root, `f${i}.txt`), 'x')
      writeFileSync(join(root, 'a', 'b', 'c', 'd', 'e', 'deep.txt'), 'deep')
      const scan = await scanFolder(root, { maxFiles: 5, maxDepth: 3 })
      expect(scan.fileCount).toBe(5)
      expect(scan.truncated).toBe(true)
      expect(scan.files.some((f) => f.rel.includes('node_modules'))).toBe(false)
      expect(scan.files.some((f) => f.rel.endsWith('deep.txt'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('extracts tree + README + samples for the folder item', async () => {
    const out = await folderExtractor.extract(
      { item: fakeItem({ type: 'folder', originalPath: FOLDER, title: 'folder-serving-benchmark' }), filePath: null },
      deps
    )
    expect(out.text).toContain('folder-serving-benchmark/')
    expect(out.text).toContain('--- README.md ---')
    expect(out.text).toContain('Small reproducible load test')
    expect(out.text).toContain('--- notes.txt ---')
    expect(out.markdown).toContain('# serving-benchmark')
    expect(out.meta.readmeTitle).toBe('serving-benchmark')
    const folder = out.meta.folder as { fileCount: number; sampledFiles: string[]; tree: string }
    expect(folder.fileCount).toBe(6)
    expect(folder.sampledFiles[0]).toBe('README.md')
    expect(folder.tree).toContain('results.csv')
    expect(out.partial).toBeUndefined()
  })
})

describe('archives, office documents, spreadsheets', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ka-arch-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('lists zip entries and reads deflated members', async () => {
    const zipPath = join(dir, 'bundle.zip')
    writeFileSync(
      zipPath,
      buildZip([
        { name: 'docs/readme.txt', data: 'hello zip' },
        { name: 'src/main.py', data: 'print("hi")\n'.repeat(20), deflate: true },
        { name: '__MACOSX/._x', data: 'junk' }
      ])
    )
    const listing = await listZip(zipPath)
    expect(listing.entryCount).toBe(3)
    expect(listing.entries.map((e) => e.name)).toEqual(['docs/readme.txt', 'src/main.py', '__MACOSX/._x'])
    expect(new TextDecoder().decode((await readZipEntry(zipPath, 'src/main.py')) ?? new Uint8Array())).toContain(
      'print("hi")'
    )
    expect(new TextDecoder().decode((await readZipEntry(zipPath, 'docs/readme.txt')) ?? new Uint8Array())).toBe(
      'hello zip'
    )
    expect(await readZipEntry(zipPath, 'missing')).toBeNull()
    const out = await archiveExtractor.extract(
      {
        item: fakeItem({ type: 'file', subtype: 'archive', metadata: { originalName: 'bundle.zip' } }),
        filePath: zipPath
      },
      deps
    )
    expect(out.text).toContain('src/main.py')
    expect(out.text).not.toContain('__MACOSX')
    expect((out.meta.archive as { format: string; entryCount: number }).format).toBe('zip')
    expect(archiveFormat('x.tar.gz')).toBe('tgz')
    expect(archiveFormat('x.7z')).toBe('other')
  })

  it('lists tar entries', async () => {
    const tarPath = join(dir, 'a.tar')
    writeFileSync(
      tarPath,
      buildTar([
        { name: 'a.txt', data: 'aaa' },
        { name: 'dir/b.md', data: '# b' }
      ])
    )
    const listing = await listTar(tarPath, false)
    expect(listing.entries.map((e) => e.name)).toEqual(['a.txt', 'dir/b.md'])
    expect(listing.uncompressedBytes).toBe(6)
    expect(listing.truncated).toBe(false)
  })

  it('reports unsupported archives as metadata only', async () => {
    const path = join(dir, 'x.7z')
    writeFileSync(path, 'not really')
    const out = await archiveExtractor.extract(
      { item: fakeItem({ type: 'file', subtype: 'archive', metadata: { originalName: 'x.7z' } }), filePath: path },
      deps
    )
    expect(out.partial).toBe(true)
    expect(out.text).toBe('')
  })

  it('reads docx text from word/document.xml', async () => {
    const docx = join(dir, 'memo.docx')
    writeFileSync(
      docx,
      buildZip([
        { name: '[Content_Types].xml', data: '<Types/>' },
        {
          name: 'word/document.xml',
          data: '<w:document><w:body><w:p><w:r><w:t>Quarterly &amp; annual</w:t></w:r></w:p><w:p><w:r><w:t>Second para</w:t></w:r></w:p></w:body></w:document>',
          deflate: true
        },
        { name: 'docProps/core.xml', data: '<cp:coreProperties><dc:title>Memo title</dc:title></cp:coreProperties>' }
      ])
    )
    const out = await officeExtractor.extract(
      {
        item: fakeItem({ type: 'file', subtype: 'document', metadata: { originalName: 'memo.docx' } }),
        filePath: docx
      },
      deps
    )
    expect(out.text).toBe('Quarterly & annual\nSecond para')
    expect(out.title).toBe('Memo title')
    expect(xmlToText('<a:p><a:r><a:t>x</a:t></a:r></a:p><a:p>y</a:p>', ['a:p'])).toBe('x\ny')
  })

  it('reads csv header + rows, and xlsx sheet names', async () => {
    expect(detectDelimiter('a\tb\tc')).toBe('\t')
    expect(splitCsvLine('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd'])
    const csv = await spreadsheetExtractor.extract(
      {
        item: fakeItem({ type: 'file', subtype: 'spreadsheet', metadata: { originalName: 'results.csv' } }),
        filePath: resolve(FOLDER, 'results.csv')
      },
      deps
    )
    expect((csv.meta.table as { columns: string[]; rowCount: number }).columns.length).toBeGreaterThan(2)
    expect(csv.text).toContain('Columns:')
    const inline = extractDelimited('name,score\nann,1\nbob,2\n', 'x.csv')
    expect(inline.meta.table).toMatchObject({ columns: ['name', 'score'], rowCount: 2, delimiter: ',' })
    expect(inline.text).toContain('name: ann · score: 1')

    const xlsx = join(dir, 'book.xlsx')
    writeFileSync(
      xlsx,
      buildZip([
        {
          name: 'xl/workbook.xml',
          data: '<workbook><sheets><sheet name="Budget" sheetId="1"/><sheet name="Notes" sheetId="2"/></sheets></workbook>'
        },
        { name: 'xl/sharedStrings.xml', data: '<sst><si><t>Revenue</t></si><si><t>Cost</t></si></sst>', deflate: true }
      ])
    )
    const book = await spreadsheetExtractor.extract(
      {
        item: fakeItem({ type: 'file', subtype: 'spreadsheet', metadata: { originalName: 'book.xlsx' } }),
        filePath: xlsx
      },
      deps
    )
    expect((book.meta.table as { sheets: string[] }).sheets).toEqual(['Budget', 'Notes'])
    expect(book.text).toContain('Revenue')
  })

  it('selects adapters by type, extension and byte sniff', async () => {
    expect((await extractorFor(fakeItem({ type: 'url' }), null)).id).toBe('url')
    expect((await extractorFor(fakeItem({ type: 'pdf' }), null)).id).toBe('pdf')
    expect((await extractorFor(fakeItem({ type: 'file', metadata: { originalName: 'a.docx' } }), null)).id).toBe(
      'office'
    )
    expect((await extractorFor(fakeItem({ type: 'file', metadata: { originalName: 'a.csv' } }), null)).id).toBe(
      'spreadsheet'
    )
    expect((await extractorFor(fakeItem({ type: 'file', metadata: { originalName: 'a.zip' } }), null)).id).toBe(
      'archive'
    )
    expect(
      (await extractorFor(fakeItem({ type: 'file', subtype: 'code', metadata: { originalName: 'a.go' } }), null)).id
    ).toBe('text')
    expect((await extractorFor(fakeItem({ type: 'video' }), null)).id).toBe('opaque')
    const pdfNoExt = join(dir, 'mystery')
    writeFileSync(pdfNoExt, '%PDF-1.4 fake')
    expect(
      (await extractorFor(fakeItem({ type: 'unknown', metadata: { originalName: 'mystery' } }), pdfNoExt)).id
    ).toBe('pdf')
    const textNoExt = join(dir, 'LICENSE')
    writeFileSync(textNoExt, 'MIT License\n\nPermission is hereby granted')
    expect(
      (await extractorFor(fakeItem({ type: 'unknown', metadata: { originalName: 'LICENSE' } }), textNoExt)).id
    ).toBe('text')
    const binary = join(dir, 'blob')
    writeFileSync(binary, new Uint8Array([0, 1, 2, 3, 0, 0, 7, 9]))
    expect((await extractorFor(fakeItem({ type: 'unknown', metadata: { originalName: 'blob' } }), binary)).id).toBe(
      'opaque'
    )
    const opaque = await opaqueExtractor.extract(
      { item: fakeItem({ type: 'video', mimeType: 'video/mp4' }), filePath: null },
      deps
    )
    expect(opaque.partial).toBe(true)
  })
})

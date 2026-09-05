// Comment hygiene: doc-comment density, single-line docs that only restate the identifier
// below them, file-header summaries, divider banners, cross-references into docs/.
//
//   node scripts/audit-comments.mjs           metrics as JSON
//   node scripts/audit-comments.mjs --list    ranked restatement candidates
//   node scripts/audit-comments.mjs --list --dir src/main/ai

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const EXT = /\.(ts|tsx)$/
const SKIP = new Set(['node_modules', 'out', 'dist', 'release', '.git'])
const STOP = new Set(
  'the a an of for for to in on and or is are this that its it with from by as at when only per all one each any not no'.split(
    ' '
  )
)

// Comments that carry machine meaning are never candidates for removal.
const LOAD_BEARING =
  /@ts-|@type|@deprecated|@internal|biome-ignore|eslint|prettier|stylex|@license|@vitest|c8 ignore|istanbul/

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (EXT.test(p)) out.push(p)
  }
  return out
}

const norm = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w)
const words = (s) =>
  s
    .toLowerCase()
    .replace(/`[^`]*`/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOP.has(w))
    .map(norm)
const identWords = (s) => words(s.replace(/([a-z0-9])([A-Z])/g, '$1 $2'))

const TICS = {
  labelColon: /^\s*\/\*\* [A-Z][a-z]+( [a-z]+)?: /,
  arrow: /→/,
  ellipsis: /…/,
  emDash: /—/,
  sliceRef: /\bslice [0-9]/i,
  forTests: /\bfor tests\b/i,
  theUser: /\bthe user\b/,
  soItCan: /\bso (it|they|that) can\b/,
  pure: /\bPure\b/,
  eg: /\be\.g\. /
}

const dirArg = process.argv.indexOf('--dir')
const base = dirArg === -1 ? join(ROOT, 'src') : join(ROOT, process.argv[dirArg + 1])

const files = walk(base)
const m = {
  files: files.length,
  exports: 0,
  docBlocks: 0,
  singleLineDocs: 0,
  headerDocs: 0,
  dividers: 0,
  sectionRefs: 0
}
const tics = Object.fromEntries(Object.keys(TICS).map((k) => [k, 0]))
const candidates = []

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  if (lines[0]?.startsWith('/**')) m.headerDocs++

  lines.forEach((line, i) => {
    if (/^export /.test(line)) m.exports++
    if (line.includes('/**')) m.docBlocks++
    if (/^\s*\/\/ -{10,}/.test(line)) m.dividers++
    if (/§/.test(line)) m.sectionRefs++

    // Count tics on every comment line, not only single-line docs. The first version of this
    // script looked at single-line docs alone, so arrows and phase refs sitting inside
    // multi-line headers were invisible to it.
    if (/^\s*(\/\*\*|\*|\/\/)/.test(line)) {
      for (const [key, re] of Object.entries(TICS)) if (re.test(line)) tics[key]++
    }

    const single = line.match(/^\s*\/\*\* (.+?) \*\/\s*$/)
    if (!single) return
    m.singleLineDocs++

    if (LOAD_BEARING.test(line)) return
    const target = lines.slice(i + 1, i + 3).find((l) => l.trim())
    if (!target) return

    const commentWords = words(single[1])
    if (commentWords.length === 0) return
    const ident = new Set(identWords(target))
    const score = commentWords.filter((w) => ident.has(w)).length / commentWords.length
    if (score >= 0.6) {
      candidates.push({
        file: relative(ROOT, file),
        line: i + 1,
        score,
        text: single[1].trim(),
        target: target.trim().slice(0, 70)
      })
    }
  })
}

m.docsPerExport = m.exports === 0 ? 0 : Number((m.docBlocks / m.exports).toFixed(2))
m.restatementCandidates = candidates.length

if (process.argv.includes('--list')) {
  candidates
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .forEach((c) => {
      console.log(`${c.score.toFixed(2)}  ${c.file}:${c.line}  /** ${c.text} */  <<  ${c.target}`)
    })
} else {
  console.log(JSON.stringify({ ...m, tics }, null, 2))
}

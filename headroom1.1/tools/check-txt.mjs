/**
 * Check a derived .txt against its Markdown source (README.txt, CHANGELOG.txt).
 *
 * The conversion is mechanical, so the failures worth guarding are the ones that
 * lose content: a dropped table row, a truncated cell, a lost paragraph. This
 * counts what should survive rather than eyeballing the output.
 *
 * Run with: node tools/check-txt.mjs <source.md> <derived.txt>
 */

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const [mdPath, txtPath] = process.argv.slice(2)
const md = readFileSync(mdPath, 'utf8')
const txt = readFileSync(txtPath, 'utf8')

let failures = 0
const check = (name, ok, detail) => {
  if (!ok) failures += 1
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail === undefined ? '' : ' :: ' + detail))
}

// ── tables: every data row must reach the output ────────────────────────────

const mdLines = md.split('\n')
const tables = []
let current = null
for (const line of mdLines) {
  if (/^\s*\|.*\|\s*$/.test(line)) {
    if (current === null) current = []
    current.push(line.trim())
    continue
  }
  if (current !== null) {
    tables.push(current)
    current = null
  }
}
if (current !== null) tables.push(current)

const isSeparator = (line) => line.replace(/^\||\|$/g, '').split('|').every((cell) => /^:?-{2,}:?$/.test(cell.trim()))

let dataRows = 0
const missingCells = []
for (const table of tables) {
  for (const row of table) {
    if (isSeparator(row)) continue
    dataRows += 1
    for (const cell of row.replace(/^\||\|$/g, '').split('|')) {
      const text = cell.trim().replace(/`/g, '').replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      if (text.length < 3) continue
      // Whitespace is inserted by wrapping, so compare without it.
      const needle = text.replace(/\s+/g, '')
      if (!txt.replace(/\s+/g, '').includes(needle)) missingCells.push(text)
    }
  }
}

console.log('tables found: ' + tables.length + ', data rows: ' + dataRows)
// A source without tables has no table row to lose. The guard still holds where
// it was aimed at: a source that has tables but yields no data row means the
// extraction broke, not that the document is table-free.
if (tables.length === 0) console.log('  SKIP  every table data row reached the output :: the source has no tables')
else check('every table data row reached the output', dataRows > 0, dataRows + ' rows')
check('no table cell text was lost', missingCells.length === 0, missingCells.slice(0, 6).join(' | '))

// ── paragraphs: every CJK run and Latin token should survive ────────────────

const squash = (text) => text.replace(/[\s\u00ad]/g, '')
const txtFlat = squash(txt)

// Fenced code blocks are copied verbatim, so they are excluded from the
// "did wrapping preserve it" question and checked separately.
const mdProse = md.replace(/```[\s\S]*?```/g, '')
const cjkRuns = [...new Set(mdProse.match(/[\u4e00-\u9fff]{8,}/g) ?? [])]
const latinTokens = [...new Set(mdProse.match(/[A-Za-z_][A-Za-z0-9_./-]{11,}/g) ?? [])]

const lostCjk = cjkRuns.filter((run) => !txtFlat.includes(run))
const lostLatin = latinTokens.filter((token) => !txtFlat.includes(token))
check('long CJK runs survive', lostCjk.length === 0, lostCjk.slice(0, 5).join(' | '))
check('long Latin tokens survive', lostLatin.length === 0, lostLatin.slice(0, 5).join(' | '))

// ── presentation ────────────────────────────────────────────────────────────

const isWide = (code) =>
  (code >= 0x1100 && code <= 0x115f) ||
  (code >= 0x2e80 && code <= 0x303e) ||
  (code >= 0x3041 && code <= 0x33ff) ||
  (code >= 0x3400 && code <= 0x4dbf) ||
  (code >= 0x4e00 && code <= 0x9fff) ||
  (code >= 0xac00 && code <= 0xd7a3) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xfe30 && code <= 0xfe6f) ||
  (code >= 0xff00 && code <= 0xff60)

const width = (text) => {
  let total = 0
  for (const char of text) total += isWide(char.codePointAt(0)) ? 2 : 1
  return total
}

const txtLines = txt.split('\n')
// Code blocks are bracketed with `~~~~`, which cannot be confused with the
// `====` section rules or the `----` sub-heading rules. Detecting fences by a
// generic run of dashes made this check report verbatim code as over-long prose.
let inFence = false
const longLines = []
txtLines.forEach((line, index) => {
  if (/^~{10,}$/.test(line)) {
    inFence = !inFence
    return
  }
  if (inFence) return
  if (width(line) > 84) longLines.push((index + 1) + ': ' + line.slice(0, 50))
})
check('prose lines fit the page width', longLines.length === 0, longLines.slice(0, 5).join(' | '))
check('code-block fences are balanced', inFence === false)
check('no replacement characters (encoding intact)', !txt.includes('\uFFFD'))

// ── syntax should be gone ───────────────────────────────────────────────────

const leftover = []
txtLines.forEach((line, index) => {
  if (/\*\*[^*]+\*\*/.test(line)) leftover.push((index + 1) + ': bold')
  if (/^\s*#{1,6}\s/.test(line)) leftover.push((index + 1) + ': heading')
  if (/^\s*\|\s*---/.test(line)) leftover.push((index + 1) + ': table separator')
})
check('no Markdown syntax left behind', leftover.length === 0, leftover.slice(0, 6).join(' | '))

console.log('')
console.log(failures === 0 ? basename(txtPath) + ' is consistent with ' + mdPath : failures + ' checks failed')
process.exit(failures === 0 ? 0 : 1)

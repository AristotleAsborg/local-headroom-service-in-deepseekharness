/**
 * Derive README.txt from README.md so the two cannot drift.
 *
 * The Markdown file is the source of truth; this turns it into plain text that
 * reads well in a terminal or a package directory, where no renderer is
 * available. It removes the syntax, not the content: headings lose their `#` but
 * keep their prominence, tables become aligned columns (or labelled blocks when
 * too wide to align), links keep their text and gain the URL in parentheses.
 *
 * Two details are easy to get wrong and are handled deliberately:
 *
 *   - Width is measured in DISPLAY columns, not characters. CJK ideographs and
 *     full-width punctuation occupy two columns, so a Chinese paragraph measured
 *     with `.length` runs to nearly twice the intended width.
 *   - A break may occur between CJK characters, not only at spaces. Chinese
 *     prose contains no spaces at all, so whitespace-only wrapping cannot fold
 *     it; Latin runs stay whole so words, identifiers and URLs are never torn.
 *
 * Run with: node tools/md-to-text.mjs <input.md> <output.txt>
 */

import { readFileSync, writeFileSync } from 'node:fs'

const [input, output] = process.argv.slice(2)
if (input === undefined || output === undefined) {
  console.error('usage: node tools/md-to-text.mjs <input.md> <output.txt>')
  process.exit(1)
}

const WIDTH = 80
const rule = (char) => char.repeat(WIDTH)

/**
 * Code blocks are bracketed with `~~~~` and inline separators use `====`.
 *
 * Both choices exist so that a READER — human or script — can tell the two
 * apart. Dashes would collide: a Markdown `---` thematic break and a fenced block
 * would open with the same characters, which made "am I inside a code block?"
 * unanswerable and let the width check report verbatim code as over-long prose.
 */
const FENCE = '~'.repeat(WIDTH)
const SECTION = '='.repeat(WIDTH)

/** Codepoints that occupy two columns in a monospace terminal. */
function isWide(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) || // Hangul Jamo
    (code >= 0x2e80 && code <= 0x303e) || // CJK radicals, Kangxi, CJK punctuation
    (code >= 0x3041 && code <= 0x33ff) || // kana, CJK compatibility
    (code >= 0x3400 && code <= 0x4dbf) || // CJK extension A
    (code >= 0x4e00 && code <= 0x9fff) || // CJK unified ideographs
    (code >= 0xa000 && code <= 0xa4cf) || // Yi
    (code >= 0xac00 && code <= 0xd7a3) || // Hangul syllables
    (code >= 0xf900 && code <= 0xfaff) || // CJK compatibility ideographs
    (code >= 0xfe30 && code <= 0xfe6f) || // CJK compatibility forms
    (code >= 0xff00 && code <= 0xff60) || // full-width forms
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x20000 && code <= 0x3fffd) // CJK extensions B+
  )
}

const isZeroWidth = (code) =>
  code === 0x200d || (code >= 0x0300 && code <= 0x036f) || (code >= 0xfe00 && code <= 0xfe0f)

/** Display width of a string in columns. */
function displayWidth(text) {
  let width = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    if (isZeroWidth(code)) continue
    width += isWide(code) ? 2 : 1
  }
  return width
}

/**
 * Split text into breakable pieces: one per CJK character, whole tokens for
 * everything else, with spaces preserved as their own pieces so they can be
 * dropped at a line break.
 *
 * Path and identifier separators deliberately do NOT create break points.
 * Breaking at `/` turned `spec/conformance-vectors.json` into
 * `spec/conformance-` + `vectors.json` in a narrow table column — the text stays
 * complete but stops being copy-pasteable, which is most of what a reader wants
 * from a filename. An over-long token overflows its column by a few characters
 * instead, which is visible and harmless.
 */
function pieces(text) {
  const result = []
  let buffer = ''
  for (const char of text) {
    const code = char.codePointAt(0)
    if (char === ' ' || isWide(code)) {
      if (buffer !== '') {
        result.push(buffer)
        buffer = ''
      }
      result.push(char)
      continue
    }
    buffer += char
  }
  if (buffer !== '') result.push(buffer)
  return result
}

/**
 * Full-width punctuation closes up against whatever precedes it.
 *
 * A source space before `（` or `，` is an artefact of mixing scripts, not
 * intent, so it is dropped; a space between two Latin runs is real and is kept.
 * Guessing from adjacency instead (space only between Latin characters) reads
 * well until it silently deletes the spaces in `corpus/ 与 bench/`, joining
 * identifiers to words.
 */
const FULL_WIDTH_PUNCTUATION = /^[（），。：；、！？「」『』【】《》〈〉—…·]/

/** Fold text at the output width, keeping the caller's indentation. */
function wrap(text, width = WIDTH) {
  const indent = /^\s*/.exec(text)[0]
  const body = text.slice(indent.length)
  if (body.trim() === '') return ['']
  const result = []
  let line = indent
  let sawSpace = false
  for (const piece of pieces(body)) {
    if (piece === ' ') {
      sawSpace = true
      continue
    }
    const separator = sawSpace && line.trim() !== '' && !FULL_WIDTH_PUNCTUATION.test(piece) ? ' ' : ''
    sawSpace = false
    if (line.trim() !== '' && displayWidth(line) + separator.length + displayWidth(piece) > width) {
      result.push(line)
      line = indent + piece
      continue
    }
    line += separator + piece
  }
  if (line.trim() !== '' || result.length === 0) result.push(line)
  return result
}

/**
 * Replace inline Markdown with its plain-text equivalent.
 *
 * Code spans are hidden behind placeholders for the duration of the emphasis
 * rules, so those rules never see the literal text inside them. Doing it the
 * obvious way — stripping the backticks first — lets the emphasis rules loose on
 * code, and they then read syntax as formatting: the two C pointer asterisks in
 * ``func (s *Store) Get(key string) *Entry`` look exactly like an emphasis pair,
 * so they were deleted and the signature came out wrong. A code span is literal
 * text; nothing inside it is Markdown, including `*` and `_`, and that is exactly
 * what the backticks assert.
 *
 * Placeholders rather than splitting on code spans: a span can sit INSIDE an
 * emphasis run (`**then reason over the `compressed` text**`), and splitting
 * would hand each fragment to the rules separately, so the opening and closing
 * `**` would land in different fragments and survive into the output as literal
 * asterisks. Holding the whole line together keeps that pair matchable.
 */
function inline(text) {
  const spans = []
  const converted = stripEmphasis(
    text.replace(/`[^`]*`/g, (span) => {
      spans.push(span.slice(1, -1))
      return '\u0000' + (spans.length - 1) + '\u0000'
    }),
  )
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '[$1: $2]')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/~~([^~]+)~~/g, '$1')
  // Restore spans first: the placeholders contain no markers, which is also what
  // keeps the cleanup below from touching literal asterisks inside code.
  return converted.replace(/\u0000(\d+)\u0000/g, (_, index) => spans[Number(index)]).trimEnd()
}

/**
 * Remove emphasis markers, in two passes, because one is not enough.
 *
 * The first pass converts a matched pair to its contents: `*x*` to `x`, `**x**`
 * to `x`. The second removes any marker left unpaired. That second pass exists
 * because `inline` runs BEFORE the text is wrapped to the page width, so a long
 * emphasis run gets split across two lines and each half then holds an unmatched
 * marker — visible in a terminal as literal `**`. Wrapping is not
 * emphasis-aware, so the stray markers have to be cleaned up wherever they land.
 *
 * The two passes are why the first one must be strict. A lazy rule that treated
 * any two markers as a pair would eat the pointer asterisks that sit in *prose*,
 * such as a C signature written without backticks; requiring a non-marker first
 * character and forbidding an opening marker followed by a space is what keeps
 * `*Store` from being read as the start of an emphasis run.
 */
function stripEmphasis(text) {
  return text
    .replace(/\*\*([^\s*][^*]*?)\*\*/g, '$1')
    .replace(/(^|[\s(])\*([^\s*][^*\n]*?)\*/g, '$1$2')
    .replace(/(^|[\s(])_([^\s_][^_\n]*?)_/g, '$1$2')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
}

const isSeparatorRow = (row) => row.every((cell) => /^:?-{2,}:?$/.test(cell))

/**
 * Render a table as aligned columns when it fits, or as labelled blocks when it
 * does not. A table too wide to align cannot be wrapped without destroying the
 * alignment, and overflowing it pushes every row off the page.
 */
function renderTable(rows) {
  const cells = rows.map((row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => inline(cell.trim())))
  const body = cells.filter((row) => !isSeparatorRow(row))
  const width = []
  for (const row of body) {
    row.forEach((cell, index) => {
      width[index] = Math.max(width[index] ?? 0, displayWidth(cell))
    })
  }
  const total = width.reduce((sum, entry) => sum + entry, 0) + 2 * Math.max(0, width.length - 1)

  if (body.length > 0 && total <= WIDTH - 2) {
    const pad = (cell, to) => cell + ' '.repeat(Math.max(0, to - displayWidth(cell)))
    const rule = '  ' + width.map((entry) => '-'.repeat(entry)).join('  ')
    const out = []
    body.forEach((row, index) => {
      // The separator goes BETWEEN the header and the first data row. An earlier
      // version emitted it in place of row index 1, which silently overwrote the
      // first data row — a whole table record disappeared from the output.
      if (index === 1) out.push(rule)
      out.push(('  ' + row.map((cell, column) => pad(cell, width[column] ?? 0)).join('  ')).trimEnd())
    })
    return out
  }

  const headers = body[0] ?? []
  const bodyRows = body.slice(1)
  /**
   * The first column is usually the row's identity rather than one of its
   * attributes — `JSON`, `代码`, `调试日志`. Repeating it as `类型: JSON` on
   * every block reads badly, so it becomes the block's title whenever it is
   * short and mostly distinct. A long or repeated first column is data and keeps
   * its label.
   */
  const firstColumn = bodyRows.map((row) => row[0] ?? '')
  const titled =
    firstColumn.length > 0 &&
    new Set(firstColumn).size === firstColumn.length &&
    firstColumn.every((cell) => displayWidth(cell) <= 28 && !cell.includes('\n'))

  const out = []
  for (const row of bodyRows) {
    if (out.length > 0) out.push('')
    if (titled) out.push('  ' + row[0])
    row.forEach((cell, index) => {
      if (titled && index === 0) return
      const header = headers[index]
      const label = header === undefined || header === '' ? 'column ' + (index + 1) : header
      const lines = wrap(cell, WIDTH - 4)
      if (lines.length <= 1) {
        out.push('  ' + label + ': ' + (lines[0] ?? ''))
        return
      }
      out.push('  ' + label + ':')
      for (const entry of lines) out.push('    ' + entry.trimStart())
    })
  }
  return out
}

// ── parse ───────────────────────────────────────────────────────────────────

const source = readFileSync(input, 'utf8').replace(/\r\n/g, '\n')
const out = []

let inFence = false
let fenceMarker = ''
let paragraph = ''
let listItem = null
let table = []

function flushParagraph() {
  if (paragraph === '') return
  out.push(...wrap(paragraph))
  out.push('')
  paragraph = ''
}

function flushList() {
  if (listItem === null) return
  const { marker, text } = listItem
  const lines = wrap(marker + text)
  out.push(lines[0])
  // Continuation lines align under the item's text, not under its bullet.
  const hanging = ' '.repeat(displayWidth(marker))
  for (const line of lines.slice(1)) out.push(hanging + line.trimStart())
  listItem = null
}

function flushTable() {
  if (table.length === 0) return
  out.push(...renderTable(table))
  out.push('')
  table = []
}

function flushAll() {
  flushParagraph()
  flushList()
  flushTable()
}

for (const raw of source.split('\n')) {
  const line = raw.trimEnd()

  // Fenced blocks pass through untouched: inside them every character is
  // content, including the `#`, `*` and `|` that are markup everywhere else.
  const fence = /^\s*(```+|~~~+)/.exec(line)
  if (fence !== null) {
    flushAll()
    if (!inFence) {
      inFence = true
      fenceMarker = fence[1]
      out.push(FENCE)
      continue
    }
    if (fence[1][0] === fenceMarker[0]) {
      inFence = false
      out.push(FENCE)
      out.push('')
      continue
    }
    out.push(line)
    continue
  }
  if (inFence) {
    out.push(line)
    continue
  }

  if (/^\s*\|.*\|\s*$/.test(line)) {
    flushParagraph()
    flushList()
    table.push(line.trim())
    continue
  }
  flushTable()

  if (line.trim() === '') {
    flushAll()
    continue
  }

  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    flushAll()
    out.push(SECTION)
    out.push('')
    continue
  }

  const heading = /^(#{1,6})\s+(.*)$/.exec(line)
  if (heading !== null) {
    flushAll()
    const text = inline(heading[2])
    if (heading[1].length === 1) {
      out.push(SECTION)
      out.push(text.toUpperCase())
      out.push(SECTION)
    } else if (heading[1].length === 2) {
      out.push('')
      out.push(text)
      out.push('-'.repeat(WIDTH))
    } else {
      out.push('')
      out.push(text)
    }
    out.push('')
    continue
  }

  const quote = /^>\s?(.*)$/.exec(line)
  if (quote !== null) {
    flushAll()
    for (const wrapped of wrap('  ' + inline(quote[1]))) out.push('  | ' + wrapped.trimStart())
    continue
  }

  // A new marker commits the previous item; an indented line under one is a
  // continuation belonging to it.
  const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line)
  if (item !== null) {
    const nested = item[1].length > 0 && listItem !== null
    if (!nested) flushList()
    const bullet = /^\d+\.$/.test(item[2]) ? item[2] : '-'
    const marker = ' '.repeat(item[1].length) + bullet + ' '
    if (nested) {
      // Keep the nesting by writing the child beneath its parent rather than
      // folding it into the parent's paragraph.
      const lines = wrap(marker + inline(item[3]))
      out.push(lines[0])
      const hanging = ' '.repeat(displayWidth(marker))
      for (const line_ of lines.slice(1)) out.push(hanging + line_.trimStart())
      continue
    }
    listItem = { marker, text: inline(item[3]) }
    flushList()
    continue
  }

  if (/^\s{2,}\S/.test(line)) {
    if (listItem !== null) {
      // Continuation of the item above. It is still Markdown, so it goes through
      // `inline` — stripping syntax from the first line of an item but not from
      // its continuation left literal `**bold**` in the output.
      listItem.text += ' ' + inline(line.trim())
      flushList()
      continue
    }
    flushParagraph()
    out.push(...wrap(inline(line.trimEnd())))
    continue
  }

  flushList()
  paragraph = paragraph === '' ? inline(line.trim()) : paragraph + ' ' + inline(line.trim())
}

flushAll()

// Collapse runs of blank lines to at most one.
const collapsed = []
for (const line of out) {
  if (line.trim() === '' && collapsed.length > 0 && collapsed[collapsed.length - 1].trim() === '') continue
  collapsed.push(line)
}

writeFileSync(output, collapsed.join('\n').replace(/\n+$/, '\n'), 'utf8')
console.log('wrote ' + output + ' (' + collapsed.length + ' lines)')

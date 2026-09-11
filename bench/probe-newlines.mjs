/**
 * Probe newline and Unicode handling.
 *
 * Every other probe builds payloads with `\n`. Real payloads do not arrive that
 * way: a file read on Windows has CRLF, an API response may carry a BOM, a log
 * copied out of a terminal can hold a NUL or an emoji, and an editor may indent
 * with tabs where the samples use spaces. The handlers split on `\n` and rejoin
 * with `\n`, so the risk is not a crash — it is a transform that looks fine,
 * reports a saving, and then hands back text that is not what went in.
 *
 * Two properties are load-bearing and are checked for every variant:
 *
 *   - the ORIGINAL comes back byte-identical, because that is what `retrieve`
 *     promises and what makes the whole design reversible;
 *   - the compressed text never carries a replacement character that the input
 *     did not have, because that is silent corruption of a different kind.
 *
 * A refusal is a pass. `stored: false` with the original returned is the honest
 * answer for a payload that cannot be compressed safely.
 *
 * Run with: node bench/probe-newlines.mjs
 */

import { compress, detectKind, getEngine, estimateTokens } from '../lib/engine.js'

let findings = 0
let checks = 0
const log = []
const note = (kind, name, detail) => {
  log.push(kind.padEnd(5) + name.padEnd(48) + detail)
  if (kind === 'BUG' || kind === 'FAIL') findings += 1
}

const engine = getEngine({ storeMax: 512, ttlMs: 60_000 })

/** Every handler the engine can be asked for explicitly. */
const KINDS = ['diff', 'json', 'jsonl', 'log', 'code', 'text', 'lines']

/**
 * Base payloads, one per family, written with `\n`.
 *
 * Each is large enough to clear the 12% floor on its own, so a `stored: false`
 * result means the variant defeated the handler rather than that the sample was
 * too small to compress.
 */
const BASE = {
  json: JSON.stringify(
    {
      data: Array.from({ length: 60 }, (_, index) => ({
        id: 'usr_01H' + String(index).padStart(6, '0') + 'ABCDEF',
        object: 'user',
        created: 1793000000 + index * 37,
        email: 'person' + index + '@example.com',
        metadata: { plan: 'plan-' + (index % 5), seats: (index % 9) + 1, region: 'eu-west-' + (index % 3) },
      })),
    },
    null,
    2,
  ),
  jsonl: Array.from({ length: 80 }, (_, index) => JSON.stringify({ seq: index, level: 'info', component: 'pool.worker', message: 'heartbeat ' + index, rss: 48213 + index })).join('\n'),
  log: Array.from({ length: 260 }, (_, index) =>
    '2026-09-11T13:0' + (index % 10) + ':' + String(index % 60).padStart(2, '0') + '.000Z DEBUG pool.worker heartbeat seq=' + index + ' idle=3 queue=0 rss=48213kb',
  ).join('\n'),
  code: [
    'import { readFileSync } from "node:fs"',
    '',
    'export class Cache {',
    '  private readonly entries = new Map()',
    '',
    '  get(key) {',
    '    const found = this.entries.get(key)',
    '    if (found === undefined) return null',
    '    return found',
    '  }',
    '',
    '  set(key, value) {',
    '    const previous = this.entries.get(key)',
    '    this.entries.set(key, value)',
    '    return previous',
    '  }',
    '}',
  ].join('\n'),
  diff: [
    'diff --git a/src/engine.js b/src/engine.js',
    'index 4f2a1bc..9d3e7fa 100644',
    '--- a/src/engine.js',
    '+++ b/src/engine.js',
    '@@ -1,7 +1,9 @@',
    ' import { readFileSync } from "node:fs"',
    '-const LIMIT = 100',
    '+const LIMIT = 200',
    '+const FLOOR = 0.12',
    ' export function run(input) {',
    ...Array.from({ length: 40 }, (_, index) => '-  const stale' + index + ' = compute(' + index + ')'),
    ...Array.from({ length: 40 }, (_, index) => '+  const fresh' + index + ' = compute(' + index + ') + 1'),
    ' }',
  ].join('\n'),
  text: Array.from({ length: 60 }, (_, index) => '## Section ' + index + '\n\nParagraph ' + index + ' explains the behaviour in a sentence or two, at enough length to matter.\n').join('\n'),
  lines: Array.from({ length: 300 }, (_, index) => 'row ' + String(index).padStart(4, '0') + ' value=' + (index * 7) + ' status=ok').join('\n'),
}

/** CRLF, CR-only, mixed, BOM, NUL, tabs, emoji, combining marks, long lines. */
const VARIANTS = [
  ['LF (baseline)', (text) => text],
  ['CRLF', (text) => text.replace(/\n/g, '\r\n')],
  ['CR only', (text) => text.replace(/\n/g, '\r')],
  ['mixed LF/CRLF', (text) => text.split('\n').map((line, index) => (index % 2 === 0 ? line : line + '\r')).join('\n')],
  ['trailing CRLF', (text) => text.replace(/\n/g, '\r\n') + '\r\n'],
  ['leading BOM', (text) => '\uFEFF' + text],
  ['BOM on a later line', (text) => text.split('\n').map((line, index) => (index === 3 ? '\uFEFF' + line : line)).join('\n')],
  ['interior NUL', (text) => text.slice(0, Math.floor(text.length / 2)) + '\u0000' + text.slice(Math.floor(text.length / 2))],
  ['tabs for indentation', (text) => text.replace(/^( +)/gm, (spaces) => '\t'.repeat(Math.ceil(spaces.length / 2)))],
  ['emoji', (text) => text.split('\n').map((line, index) => (index % 7 === 0 ? line + ' 🚀✅' : line)).join('\n')],
  ['combining marks', (text) => text.split('\n').map((line, index) => (index % 5 === 0 ? line + ' e\u0301a\u0300' : line)).join('\n')],
  ['CJK wide text', (text) => text.split('\n').map((line, index) => (index % 6 === 0 ? line + ' 中文宽度测试' : line)).join('\n')],
  ['one very long line', (text) => text.replace(/\n/g, ' ')],
  ['no trailing newline', (text) => text.replace(/\n+$/, '')],
  ['blank lines doubled', (text) => text.replace(/\n/g, '\n\n')],
  ['NEL and LS separators', (text) => text.split('\n').map((line, index) => (index % 11 === 0 ? line + '\u0085\u2028' : line)).join('\n')],
]

/** `<<hr:...>>` markers must be well formed: a name, no nesting, non-empty body. */
function malformedMarkers(text) {
  const bad = []
  for (const match of text.matchAll(/<<[^>]*>>/g)) {
    const marker = match[0]
    if (!/^<<hr:[a-z]+(?::[^>:]*)*(?::hidden=\d+)?(?::[0-9a-f]{8})?>>$/.test(marker) && !/^<<hr:(?:body|lines|log|diff|json|text|keys|schema|truncated)[^>]*>>$/.test(marker)) {
      bad.push(marker.slice(0, 60))
    }
    if (/<</.test(marker.slice(2))) bad.push('nested: ' + marker.slice(0, 60))
  }
  return bad
}

/** Run one payload through one explicit kind, asserting the invariants. */
function run(label, kind, content) {
  checks += 1
  let result = null
  try {
    result = compress(content, { store: engine.store, kind })
  } catch (error) {
    note('BUG', label + ' [' + kind + ']', 'threw: ' + error.message)
    return
  }

  if (result.stored === false) {
    if (result.compressed !== content) note('BUG', label + ' [' + kind + ']', 'refused but changed the content')
    return
  }

  // ── the original must come back exactly ───────────────────────────────────
  const found = engine.store.find(result.token)
  if (found.kind !== 'found') {
    note('BUG', label + ' [' + kind + ']', 'stored token does not resolve: ' + found.kind)
    return
  }
  const back = found.entry.text
  if (back !== content) {
    note('BUG', label + ' [' + kind + ']', 'round trip differs: in ' + content.length + ' chars, out ' + String(back).length)
    return
  }

  // ── the visible text must not be corrupt or larger ────────────────────────
  if (result.compressed.length >= content.length) {
    note('BUG', label + ' [' + kind + ']', 'output not smaller (' + content.length + ' -> ' + result.compressed.length + ')')
  }
  const inputHadReplacement = content.includes('\uFFFD')
  if (!inputHadReplacement && result.compressed.includes('\uFFFD')) {
    note('BUG', label + ' [' + kind + ']', 'output introduced U+FFFD')
  }
  const bad = malformedMarkers(result.compressed)
  if (bad.length > 0) note('BUG', label + ' [' + kind + ']', 'malformed marker: ' + bad[0])
  if (result.compressedTokens !== estimateTokens(result.compressed)) {
    note('BUG', label + ' [' + kind + ']', 'reported token count disagrees with the estimator')
  }

  // A CRLF payload compressed by a `\n`-splitting handler should not come back
  // with its line endings rewritten in the visible text: the reader copies from
  // the visible text, and a silently reflowed file is the corruption this probe
  // exists to catch. Reported as an observation, not a failure, when the saving
  // is real — the marker digests are computed over the original.
  if (content.includes('\r\n') && !result.compressed.includes('\r\n')) {
    note('WARN', label + ' [' + kind + ']', 'CRLF input, LF-only output (' + result.savedPercent + '% saved)')
  }
  if (content.includes('\u0000') && !result.compressed.includes('\u0000')) {
    note('WARN', label + ' [' + kind + ']', 'NUL dropped from the visible text')
  }
}

// ── the matrix ──────────────────────────────────────────────────────────────

for (const [family, base] of Object.entries(BASE)) {
  for (const [variant, mutate] of VARIANTS) {
    const content = mutate(base)
    // Auto-detection first: that is the path a session actually takes.
    let detected = 'error'
    try {
      detected = detectKind(content)
    } catch (error) {
      note('BUG', family + ' / ' + variant, 'detectKind threw: ' + error.message)
      continue
    }
    if (!KINDS.includes(detected)) {
      note('BUG', family + ' / ' + variant, 'detectKind returned ' + JSON.stringify(detected))
      continue
    }
    run(family + ' / ' + variant, detected, content)
    // Then every handler explicitly, so a variant cannot hide behind detection.
    for (const kind of KINDS) {
      if (kind === detected) continue
      run(family + ' / ' + variant, kind, content)
    }
  }
}

// ── the jsonl handler, which detection never routes to ──────────────────────

/**
 * `jsonl` is unreachable by detection: a JSONL stream has the JSON *shape*, so
 * `detectKind` reports `json` and the handler is only reached when the JSON
 * handler declines the document. That makes it easy to break silently — nothing
 * routes to it directly — so it is asserted here by name.
 *
 * The property that matters is that factoring hoists the KEYS without dropping
 * RECORDS. A stream that compresses to a key list and a fraction of its rows
 * would look like a triumph and be useless.
 */
{
  const rows = Array.from({ length: 120 }, (_, index) => ({
    seq: index,
    level: index % 9 === 0 ? 'warn' : 'info',
    component: 'pool.worker',
    id: 'rec_' + String(index).padStart(6, '0') + '_ABC',
    message: 'heartbeat ' + index + ' delivered',
    rss: 48213 + index * 7,
  }))
  const stream = rows.map((row) => JSON.stringify(row)).join('\n')

  const result = compress(stream, { store: engine.store, kind: 'auto' })
  if (result.stored === false) {
    note('FAIL', 'jsonl: reaches the handler', 'refused: ' + result.note)
  } else {
    if (result.kind !== 'jsonl') note('FAIL', 'jsonl: chosen for a JSONL stream', 'kind=' + result.kind)
    const found = engine.store.find(result.token)
    if (found.kind !== 'found' || found.entry.text !== stream) note('BUG', 'jsonl: round trip', found.kind)
    // Every record id must still be present, or the stream lost records.
    const missing = rows.map((row) => row.id).filter((id) => !result.compressed.includes(id))
    if (missing.length > 0) note('BUG', 'jsonl: records lost', missing.length + ' of ' + rows.length + ' ids gone')
    else note('ok', 'jsonl: every record id survives', rows.length + ' ids, ' + result.savedPercent + '% saved')
  }
}

// ── payloads that are nothing but separators ────────────────────────────────
for (const [name, content] of [
  ['empty', ''],
  ['single newline', '\n'],
  ['only newlines', '\n'.repeat(50)],
  ['only CRLF', '\r\n'.repeat(50)],
  ['only spaces', ' '.repeat(400)],
  ['only tabs', '\t'.repeat(400)],
  ['only a BOM', '\uFEFF'],
  ['lone surrogate', 'ab\uD800cd'.repeat(40)],
  ['replacement char present', '\uFFFD'.repeat(200)],
  ['one long line no newline', 'x'.repeat(5000)],
]) {
  for (const kind of ['auto', ...KINDS]) {
    run('degenerate / ' + name, kind, content)
  }
}

// ── report ──────────────────────────────────────────────────────────────────

console.log(log.join('\n'))
const warnings = log.filter((line) => line.startsWith('WARN')).length
console.log('')
console.log(checks + ' compress calls: ' + Object.keys(BASE).length + ' families x ' + VARIANTS.length +
  ' variants x ' + (KINDS.length + 1) + ' kinds, plus degenerate payloads')
console.log(findings === 0
  ? 'no findings in ' + checks + ' calls (' + warnings + ' observation(s) reported as WARN)'
  : findings + ' finding(s) in ' + checks + ' calls')

process.exit(findings === 0 ? 0 : 1)

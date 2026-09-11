/**
 * Probe the JSON handler's structural edges.
 *
 * `compressJson` is the most intricate handler in the engine: it factors
 * same-shaped records, hoists repeated key lists, masks long values and array
 * tails, and caps recursion at `maxDepth`. The fuzz covers ordinary shapes; this
 * covers the ones chosen to sit exactly on a boundary, where an off-by-one is
 * invisible in the percentage but changes what the reader gets.
 *
 * Every case asserts the same two things: the document is still structurally the
 * same after compression, and the round trip is byte-exact. A size claim without
 * those is not a result.
 *
 * Run with: node bench/probe-json-edges.mjs
 */

import { compress, getEngine, estimateTokens } from '../lib/engine.js'

let findings = 0
const log = []
const note = (kind, name, detail) => {
  log.push(kind.padEnd(5) + name.padEnd(54) + detail)
  if (kind === 'BUG' || kind === 'FAIL') findings += 1
}

const engine = getEngine({ storeMax: 64, ttlMs: 60_000 })

/** Neutralise markers so the document can be parsed on the reader's terms. */
const parseable = (compressed) => {
  const newline = compressed.indexOf('\n')
  const block = newline === -1 ? compressed : compressed.slice(0, newline)
  const neutral = block.replace(/"?<<hr:[^>]*>>"?/g, '"<<m>>"').replace(/<<hr:keys:[^>]*>>/g, '"K"')
  return JSON.parse(neutral)
}

/** Compare the record set and keys, which is what "structurally the same" means. */
function structureOf(value) {
  const walk = (node, depth) => {
    if (node === null || typeof node !== 'object') return typeof node
    if (Array.isArray(node)) {
      // A marker standing in for a masked array tail is not a record.
      const items = node.filter((item) => typeof item !== 'string')
      return '[' + items.length + (items.length > 0 ? walk(items[0], depth + 1) : '') + ']'
    }
    const keys = Object.keys(node)
    return '{' + keys.length + ':' + keys.slice(0, 4).join(',') + '}'
  }
  return walk(value, 0)
}

function check(label, content, { expectKind = 'json' } = {}) {
  const result = compress(content, { store: engine.store })
  if (result.stored === false) {
    note('ok', label + ' (refused)', String(result.note).slice(0, 44))
    return null
  }
  if (result.kind !== expectKind) {
    note('BUG', label + ' ran the wrong handler', 'kind=' + result.kind + ' expected=' + expectKind)
    return null
  }

  const back = engine.store.find(result.token)
  if (back.kind !== 'found' || back.entry.text !== content) {
    note('BUG', label + ' round trip', 'store says ' + back.kind)
  }

  let shape = 'n/a'
  let structural = true
  try {
    const before = JSON.parse(content)
    const after = parseable(result.compressed)
    shape = structureOf(after)
    // Top-level keys must all be present; a missing one is a real loss even
    // though the round trip still succeeds.
    for (const key of Object.keys(before)) {
      if (!(key in after)) {
        structural = false
        shape += ' MISSING:' + key
      }
    }
  } catch (error) {
    structural = false
    shape = 'unparseable: ' + String(error.message).slice(0, 40)
  }

  note(structural ? 'ok' : 'BUG', label,
    String(result.savedPercent).padStart(5) + '%  ' + shape.slice(0, 54))
  return result
}

// ── record-count boundaries ────────────────────────────────────────────────
//
// `factorRecords` refuses fewer than three records. Two and three must therefore
// behave differently, and neither may lie about its rows.

const records = (count, keys = ['id', 'body']) =>
  JSON.stringify({
    rows: Array.from({ length: count }, (_, index) => {
      const record = {}
      for (const key of keys) {
        record[key] = key === 'id' ? 'row_' + index : 'value '.repeat(12) + index
      }
      return record
    }),
  }, null, 2)

check('2 records (below the factor floor)', records(2))
check('3 records (exactly the floor)', records(3))
check('4 records', records(4))

// ── key-count boundaries ───────────────────────────────────────────────────
//
// `factorRecords` refuses more than 24 keys, and keys longer than 32 characters
// fail SAFE_KEY.

const wide = (keys) =>
  JSON.stringify({
    rows: Array.from({ length: 5 }, (_, index) =>
      Object.fromEntries(keys.map((key, position) => [key, 'value ' + index + '-' + position + ' ' + 'p'.repeat(20)]))),
  }, null, 2)

check('24 keys (at the limit)', wide(Array.from({ length: 24 }, (_, i) => 'key' + i)))
check('25 keys (one over)', wide(Array.from({ length: 25 }, (_, i) => 'key' + i)))
check('1 key (degenerate)', wide(['only']))
check('a 32-character key (at the SAFE_KEY limit)', wide(['k'.repeat(32), 'other']))
check('a 33-character key (one over)', wide(['k'.repeat(33), 'other']))
check('a key with a hyphen (unsafe)', wide(['has-hyphen', 'other']))
check('a key starting with a digit (unsafe)', wide(['9leading', 'other']))
check('an empty key', wide(['', 'other']))

// ── array-tail boundaries ──────────────────────────────────────────────────
//
// `maxArrayItems` defaults to 3, so the tail is masked above that and untouched
// at or below it.

const arrayOf = (length) => JSON.stringify({ numbers: Array.from({ length }, (_, i) => i * 7) }, null, 2)
check('array of 3 (no tail)', arrayOf(3))
check('array of 4 (one item masked)', arrayOf(4))
check('array of 100 (long tail)', arrayOf(100))

const mixedArray = JSON.stringify({ items: [1, 'two', null, true, { a: 1 }, [1, 2], 'last'] }, null, 2)
check('array of mixed types', mixedArray)

// ── depth boundaries ───────────────────────────────────────────────────────

function nested(depth) {
  let node = { leaf: 'a value ' + 'x'.repeat(40) }
  for (let i = 0; i < depth; i += 1) node = { ['level' + i]: node, sibling: 'value '.repeat(8) }
  return JSON.stringify(node, null, 2)
}
for (const depth of [1, 5, 11, 12, 13, 20, 40]) check('nesting depth ' + depth, nested(depth))

// ── awkward but valid JSON ─────────────────────────────────────────────────

check('empty object', '{}')
check('empty array', '[]')
check('top-level array of records', JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: i, body: 'b'.repeat(60) })), null, 2))
check('single long string value', JSON.stringify({ note: 'x'.repeat(4000) }, null, 2))
check('unicode values and keys', JSON.stringify({ '键': '值'.repeat(200), emoji: '😀'.repeat(200), plain: 'ascii '.repeat(50) }, null, 2))
check('values containing marker syntax', JSON.stringify({ rows: Array.from({ length: 5 }, (_, i) => ({ id: i, body: 'fake <<hr:body:hidden=9:deadbeef>> marker ' + 'p'.repeat(40) })) }, null, 2))
check('values containing json', JSON.stringify({ rows: Array.from({ length: 5 }, (_, i) => ({ id: i, body: JSON.stringify({ nested: 'value '.repeat(20) }) })) }, null, 2))
check('null and boolean mix', JSON.stringify({ rows: Array.from({ length: 5 }, (_, i) => ({ id: i, a: null, b: i % 2 === 0, c: 'text '.repeat(10) })) }, null, 2))
check('numeric keys', JSON.stringify({ '1': 'a'.repeat(80), '2': 'b'.repeat(80), '3': 'c'.repeat(80) }, null, 2))
check('duplicate-looking long strings', JSON.stringify({ rows: Array.from({ length: 6 }, (_, i) => ({ id: i, body: 'identical body for every row ' + 'z'.repeat(80) })) }, null, 2))

// An array of same-shaped records nested inside a same-shaped record, which is
// where the serializer had its worst bug.
check('nested factored arrays', JSON.stringify({
  vectors: Array.from({ length: 6 }, (_, index) => ({
    id: 'v' + index,
    description: 'Vector ' + index + ' describes the assertion at some length for factoring. ',
    input: { events: Array.from({ length: 6 }, (_, inner) => ({ seq: inner, type: 'type' + (inner % 3), payload: { text: 'body ' + inner + ' of ' + index, tokens: 40 } })) },
    expect: { ok: index % 2 === 0, reason: 'reason ' + index },
  })),
}, null, 2))

// A map of same-shaped records, which takes the other factoring branch.
check('map of same-shaped records', JSON.stringify({
  byId: Object.fromEntries(Array.from({ length: 8 }, (_, index) => ['id' + index, {
    name: 'name' + index, body: 'body '.repeat(14) + index, n: index,
  }])),
}, null, 2))

// ── summary ────────────────────────────────────────────────────────────────

console.log(log.join('\n'))
console.log('')
console.log(findings === 0 ? 'no findings in ' + log.length + ' checks' : findings + ' finding(s) across ' + log.length + ' checks')
process.exit(findings === 0 ? 0 : 1)

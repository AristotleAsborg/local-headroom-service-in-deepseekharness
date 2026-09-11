/**
 * Differential check for the handler-dispatch fast path.
 *
 * `compress` now runs the detected handler first and skips the other five when it
 * already clears the savings floor. That is a pure-work optimisation, and the only
 * acceptable outcome is that nothing observable changes. This replays a wide
 * corpus through both orderings — the shipped one and the deliberately
 * unoptimised `fullScan` one — and compares every reported field.
 *
 * Comparing against the same code under a flag, rather than against a
 * reimplementation, is deliberate: a second implementation would eventually
 * drift, and agreement with drift proves nothing. Here the two paths share every
 * handler, so any difference is caused by the dispatch itself.
 *
 * Run with: node bench/probe-dispatch-diff.mjs [--count 400]
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compress, getEngine } from '../lib/engine.js'
import { CONVERSATIONS, readIndex } from './lib/measure.mjs'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}
const COUNT = Number(flag('count', 400))

// ── a store that keeps everything, so comparison is never about capacity ─────
//
// It must be real enough for `compress` to take its storing branch: a store
// without `put` makes every call report `stored: false`, and the comparison would
// then be between two refusals.

function makeStore() {
  const kept = new Map()
  return {
    put(token, entry) {
      kept.set(token, entry)
      return token
    },
    find(token) {
      return kept.has(token) ? { kind: 'found', entry: kept.get(token) } : { kind: 'missing' }
    },
    expire() {
      return 0
    },
    clear() {
      return kept.size
    },
    describe() {
      return { entries: kept.size, bytes: 0, tokens: 0, max: 0, ttlMinutes: 0 }
    },
  }
}

const FIELDS = [
  'kind', 'detected', 'confident', 'compressed', 'stored',
  'originalTokens', 'compressedTokens', 'savedTokens', 'savedPercent', 'truncated',
]

/** Every field a caller can observe, as one comparable string. */
function signature(content, options) {
  const result = compress(content, { store: makeStore(), ...options })
  return FIELDS.map((field) => field + '=' + String(result[field])).join('\u0001')
}

// ── the corpus ──────────────────────────────────────────────────────────────

const payloads = []
const index = readIndex()
for (const conversation of index.conversations) {
  for (const payload of conversation.payloads) {
    payloads.push([
      conversation.id + '/' + payload.name,
      readFileSync(join(CONVERSATIONS, conversation.id, payload.name), 'utf8'),
    ])
  }
}

payloads.push(
  ['empty', ''],
  ['space', ' '],
  ['newline', '\n'],
  ['one char', 'x'],
  ['marker-like', 'before <<hr:body:hidden=10:abcdef01>> after'],
  ['cjk prose', '团队在评审中详细讨论了这个提案。它开篇声称该变更降低了耦合。'.repeat(40)],
  ['crlf json', JSON.stringify({ a: Array.from({ length: 40 }, (_, i) => ({ id: i, note: 'n'.repeat(40) })) }, null, 2).replace(/\n/g, '\r\n')],
  ['primitive arrays', JSON.stringify({ n: Array.from({ length: 100 }, (_, i) => i * 7) }, null, 2)],
  ['awkward json', JSON.stringify({ '键1': 'a', '123': 1, 'a b': 2, '': 3, 'q"x': 4 }, null, 2)],
  ['log only', Array.from({ length: 400 }, (_, i) => '2026-03-14T09:00:00.000Z DEBUG hb ' + i).join('\n')],
  ['indented code', ['def f(x):', ...Array.from({ length: 40 }, (_, i) => '    y = x + ' + i + '\n    return y')].join('\n')],
  ['tiny json', '{"a":1}'],
  ['deep json', JSON.stringify(nest(30), null, 2)],
)

function nest(depth) {
  let node = { leaf: true }
  for (let i = 0; i < depth; i += 1) node = { ['level' + i]: node, sibling: 'value '.repeat(6) }
  return node
}

// A synthetic sweep, so the comparison is not limited to the shipped fixtures.
function mulberry(seed) {
  let state = (seed >>> 0) || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const WORDS = 'alpha beta gamma delta epsilon zeta eta theta iota kappa'.split(' ')
for (let i = 0; i < COUNT; i += 1) {
  const random = mulberry(9000 + i)
  const lines = []
  const count = 5 + Math.floor(random() * 200)
  for (let n = 0; n < count; n += 1) {
    const roll = random()
    if (roll < 0.3) lines.push('2026-03-14T09:00:00.000Z DEBUG hb seq=' + n)
    else if (roll < 0.45) lines.push('2026-03-14T09:00:01.000Z ERROR failed: ' + WORDS[n % WORDS.length])
    else if (roll < 0.6) lines.push('    at fn' + n + ' (/srv/app/x-' + n + '.js:' + n + ':1)')
    else if (roll < 0.7) lines.push('@@ -' + n + ',3 +' + n + ',4 @@')
    else if (roll < 0.8) lines.push('-old ' + n)
    else if (roll < 0.9) lines.push('+new ' + n)
    else if (roll < 0.95) lines.push('  const value' + n + ' = compute(' + n + ')')
    else lines.push('  "key' + n + '": "value ' + n + '",')
  }
  payloads.push(['synthetic ' + i, lines.join(random() < 0.3 ? '\r\n' : '\n')])
}

// ── compare ─────────────────────────────────────────────────────────────────

const differences = []
let stored = 0
let refused = 0

for (const [label, content] of payloads) {
  const fast = signature(content, {})
  const slow = signature(content, { fullScan: true })
  if (fast.includes('stored=true')) stored += 1
  else refused += 1

  if (fast !== slow) {
    const fastFields = fast.split('\u0001')
    const slowFields = slow.split('\u0001')
    const differing = fastFields
      .map((field, position) => (field === slowFields[position] ? null : field.split('=')[0]))
      .filter((field) => field !== null)
    differences.push([label, 'fields differ: ' + differing.join(', ')])
  }
}

// Determinism, twice over, so a leaked cache would show up as a difference.
let nondeterministic = 0
for (const [label, content] of payloads.slice(0, 60)) {
  if (signature(content, {}) !== signature(content, {})) {
    nondeterministic += 1
    differences.push([label, 'not deterministic across two identical calls'])
  }
}

// The forced-kind path must agree with itself too: a caller who names a kind gets
// that handler or a refusal, never a different handler silently.
for (const kind of ['json', 'code', 'log', 'text', 'diff', 'lines']) {
  for (const [label, content] of payloads.slice(0, 40)) {
    const fast = signature(content, { kind })
    const slow = signature(content, { kind, fullScan: true })
    if (fast !== slow) differences.push([label + ' [kind=' + kind + ']', 'forced-kind result differs'])
  }
}

console.log('dispatch differential')
console.log('  payloads compared        ' + payloads.length)
console.log('  stored by the shipped    ' + stored)
console.log('  refused by the shipped   ' + refused)
console.log('  forced-kind comparisons  ' + 6 * 40)
console.log('  differences              ' + differences.length)
console.log('  nondeterministic         ' + nondeterministic)
console.log('')
if (differences.length > 0) {
  for (const [label, detail] of differences.slice(0, 15)) console.log('  DIFF ' + label + ': ' + detail)
  console.log('')
  console.log('the fast path changed observable behaviour')
  process.exit(1)
}
console.log('the fast path is behaviour-preserving across ' + payloads.length + ' payloads')

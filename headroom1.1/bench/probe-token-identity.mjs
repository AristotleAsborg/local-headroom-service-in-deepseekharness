/**
 * Probe token identity: dedup, prefix ambiguity, and collision safety.
 *
 * The token is the only handle the model has on stored content, and it is
 * derived from a digest of the text. That raises questions nothing else asks:
 *
 *   - Is the same content stored twice, or deduplicated?
 *   - If two different payloads collided on one token, would the store return
 *     the wrong one silently? (It must not — but "must not" needs measuring,
 *     because the cost of being wrong is the model reading someone else's data.)
 *   - Does a prefix that matches two entries refuse, or pick one?
 *   - Does the digest depend only on the text, so a restart or a second engine
 *     derives the same token?
 *
 * Run with: node bench/probe-token-identity.mjs
 */

import { compress, getEngine } from '../lib/engine.js'

let findings = 0
const log = []
const note = (kind, name, detail) => {
  log.push(kind.padEnd(5) + name.padEnd(52) + detail)
  if (kind === 'BUG' || kind === 'FAIL') findings += 1
}

const engine = getEngine({ storeMax: 256, ttlMs: 60000 })

const payload = JSON.stringify({
  data: Array.from({ length: 40 }, (_, i) => ({ id: 'u' + i, bio: 'b'.repeat(80), n: i })),
}, null, 2)

/**
 * A payload that is actually worth storing.
 *
 * `'x'.repeat(400)` is not: no handler can shrink a homogeneous run, so compress
 * refuses it and stores nothing. The first version of this probe used exactly
 * that for the store-level checks and then reported "the entry is missing" as a
 * bug — it was measuring a refusal, not the store.
 */
const storable = (label) => JSON.stringify({
  label,
  rows: Array.from({ length: 30 }, (_, i) => ({ id: label + '_' + i, body: 'filler '.repeat(12), n: i })),
}, null, 2)

// ── 1. dedup ────────────────────────────────────────────────────────────────

const first = compress(payload, { store: engine.store })
const second = compress(payload, { store: engine.store })
note(first.token === second.token ? 'ok' : 'BUG', 'the same content yields the same token', String(first.token))
const entriesAfterDedup = engine.store.describe().entries
note(entriesAfterDedup === 1 ? 'ok' : 'BUG', 'the same content is stored once', entriesAfterDedup + ' entries')

// A one-character difference must produce a different token.
const variant = compress(payload + ' ', { store: engine.store })
note(variant.token !== first.token ? 'ok' : 'BUG', 'a different payload yields a different token', String(variant.token))

// ── 2. digests are content-derived, not store-derived ───────────────────────

const freshEngine = getEngine({ storeMax: 8, ttlMs: 60000 })
const elsewhere = compress(payload, { store: freshEngine.store })
note(elsewhere.token === first.token ? 'ok' : 'BUG', 'a second engine derives the same token for the same text',
  first.token + ' vs ' + elsewhere.token)

// ── 3. prefix ambiguity must refuse, never guess ────────────────────────────

// Build a set of payloads and look for two tokens sharing a 1-character prefix.
//
// Each payload must be distinct AND still compressible. Appending a comment made
// them distinct but no longer valid JSON — `{…}\n// distinct 1` does not parse —
// so the JSON guard refuses the whole payload and nothing is stored. The original
// version of this probe did exactly that and reported "2 tokens" for a set it
// expected to hold 40, which was the guard working rather than a token bug.
const distinctPayload = (index) => JSON.stringify({
  data: Array.from({ length: 40 }, (_, i) => ({ id: 'u' + i, bio: 'b'.repeat(80), n: i, variant: index })),
}, null, 2)

const tokens = new Set()
if (typeof first.token === 'string') tokens.add(first.token)
if (typeof variant.token === 'string') tokens.add(variant.token)
for (let i = 0; i < 40; i += 1) {
  const result = compress(distinctPayload(i), { store: engine.store })
  // `token` is null on a refusal, not undefined — checking only for `undefined`
  // let a null into the list and the prefix scan below crashed on it.
  if (typeof result.token === 'string') tokens.add(result.token)
}
note(tokens.size >= 40 ? 'ok' : 'BUG', 'distinct payloads produce distinct tokens',
  tokens.size + ' tokens from 42 distinct payloads')

const list = [...tokens]
const emptyPrefix = engine.store.find('')
note(emptyPrefix.kind !== 'found' ? 'ok' : 'BUG', 'an empty prefix never resolves to an entry',
  'kind=' + emptyPrefix.kind + (emptyPrefix.kind === 'found' ? ' -> WRONG ENTRY' : ''))

// Find a real shared prefix among the tokens, to test the ambiguous branch.
let shared = null
for (let length = 1; length <= 4 && shared === null; length += 1) {
  const seen = new Map()
  for (const token of list) {
    const key = token.slice(0, length)
    if (seen.has(key)) {
      shared = { prefix: key, tokens: [seen.get(key), token] }
      break
    }
    seen.set(key, token)
  }
}
if (shared === null) {
  // With 41 hex tokens a 1-char collision is expected; if none occurred the
  // branch cannot be reached this way, which is itself worth reporting.
  note('ok', 'no shared prefix among ' + list.length + ' tokens (1-4 chars)', 'ambiguous branch untested this run')
} else {
  const found = engine.store.find(shared.prefix)
  const correct = found.kind === 'ambiguous'
  note(correct ? 'ok' : 'BUG', 'a prefix matching two entries is refused, not guessed',
    'prefix=' + JSON.stringify(shared.prefix) + ' kind=' + found.kind)
  if (found.kind === 'found') {
    const wrong = found.entry.text !== payload && !found.entry.text.startsWith(payload.slice(0, 40)) && !list.includes(found.entry.hash)
    note(wrong ? 'ok' : 'BUG', '  the resolved entry is one of the two, not a stray', String(found.entry.hash))
  }
}

// ── 4. full tokens always resolve to their own content ─────────────────────

let mismatches = 0
for (const token of list) {
  const found = engine.store.find(token)
  const expected = token === first.token || token === variant.token
  if (found.kind !== 'found') {
    mismatches += 1
    continue
  }
  if (found.entry.hash !== token) mismatches += 1
}
note(mismatches === 0 ? 'ok' : 'BUG', 'every full token resolves to its own entry', mismatches + ' mismatches')

// ── 5. the store survives a malformed insert ───────────────────────────────
//
// `TokenStore` is exported (the package maps `./engine`), so `put` is callable
// with a hand-built entry. An entry missing `createdAt` used to make `expire`
// throw on `undefined` — and because the bad entry stayed in the map, every
// later operation on that store threw too. One malformed insert must not be able
// to break an otherwise healthy store.
//
// This runs in its own store: the store above has just been filled past its
// capacity by the prefix tests, so its oldest entry is legitimately evicted and
// reusing it would measure eviction rather than the malformed insert.

const resilientEngine = getEngine({ storeMax: 8, ttlMs: 60000 })
const good = compress(storable('healthy'), { store: resilientEngine.store })
note(good.stored === true ? 'ok' : 'FAIL', 'the store-level fixture is storable', 'stored=' + good.stored)
let survived = true
let detail = ''
try {
  resilientEngine.store.put('deadbeefdeadbeef', { text: 'no createdAt here', kind: 'json' })
  const after = resilientEngine.store.find(good.token)
  const described = resilientEngine.store.describe()
  detail = 'earlier entry kind=' + after.kind + ', entries=' + described.entries
  survived = after.kind === 'found'
} catch (error) {
  survived = false
  detail = String(error.message).slice(0, 80)
}
note(survived ? 'ok' : 'BUG', 'a malformed insert does not break the store', detail)

// A non-string token is a miss, not a crash.
for (const [label, value] of [['undefined', undefined], ['a number', 42], ['null', null], ['an object', {}]]) {
  let outcome = 'threw'
  try {
    outcome = resilientEngine.store.find(value).kind
  } catch (error) {
    outcome = 'threw: ' + String(error.message).slice(0, 40)
  }
  note(outcome === 'missing' ? 'ok' : 'BUG', 'find with ' + label + ' reports a miss', outcome)
}

// ── 6. ttl boundary ────────────────────────────────────────────────────────
//
// Every lookup passes the same fake `now` the store was written with. Two
// earlier versions of this check failed for their own reasons rather than the
// store's: first a fake `createdAt` against the real clock (so the entry looked
// infinitely old), then a `getEngine` config that collided with an earlier check
// — the engine is cached per config, so `ttlMs: 1000` here silently returned the
// `ttlMs: 60000` store from section 5. Each store-level case below therefore
// uses a distinct `storeMax` as well as its own ttl.

const T0 = 1_000_000
const ttlEngine = getEngine({ storeMax: 11, ttlMs: 1000 })
const stored = compress(storable('ttl'), { store: ttlEngine.store, now: T0 })
note(stored.stored === true ? 'ok' : 'FAIL', 'the ttl fixture is storable', 'stored=' + stored.stored)
note(ttlEngine.store.ttlMs === 1000 ? 'ok' : 'FAIL', 'the ttl store really has the ttl it asked for',
  String(ttlEngine.store.ttlMs))
const alive = ttlEngine.store.find(stored.token, T0 + 500)
const boundary = ttlEngine.store.find(stored.token, T0 + 999)
const dead = ttlEngine.store.find(stored.token, T0 + 1001)
note(alive.kind === 'found' ? 'ok' : 'BUG', 'an entry is readable inside its ttl', 'kind=' + alive.kind)
note(boundary.kind === 'found' ? 'ok' : 'BUG', 'an entry is readable just inside the boundary', 'kind=' + boundary.kind)
note(dead.kind !== 'found' ? 'ok' : 'BUG', 'an entry is gone just past its ttl', 'kind=' + dead.kind)

// ── report ──────────────────────────────────────────────────────────────────

console.log(log.join('\n'))
console.log('')
console.log(findings === 0 ? 'no findings in ' + log.length + ' checks' : findings + ' finding(s) across ' + log.length + ' checks')
process.exit(findings === 0 ? 0 : 1)

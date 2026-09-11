/**
 * Fuzz the retrieval path: `retrieve` with a query, across ambiguous input.
 *
 * The compress path has had a differential fuzz; retrieval has had hand-written
 * cases only. It is the surface where a mistake is most expensive, because a
 * wrong answer here is not a smaller payload — it is the model believing it has
 * the content it asked for.
 *
 * The invariants:
 *
 *   1. A query that matches nothing returns zero regions, not the whole original
 *      and not a fabricated match.
 *   2. Every region reported as a literal match really contains the query. A
 *      region returned for word overlap is allowed to not contain it — that is
 *      the documented behaviour — but the two must be counted separately, so a
 *      caller who needs the exact string can tell them apart.
 *   3. A query that matches everywhere returns at most `limit` regions, and an
 *      explicit `limit: 0` returns none rather than the default.
 *   4. A regex metacharacter is a literal, not a pattern: searching for `a.c`
 *      must not match `abc` as a literal, and `(` must not throw.
 *   5. Retrieval never mutates the store: the same token still returns the same
 *      whole original afterwards.
 *   6. `matched` and `literalMatches` agree with the returned regions.
 *
 * Run with: node bench/fuzz-retrieve.mjs [--count 200]
 */

import { asUrl, requireExistingPath } from '../dsh-paths.mjs'

const installed = requireExistingPath('installedEntry')
const plugin = await import(asUrl(installed))

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}
const COUNT = Number(flag('count', 200))

let tool = null
plugin.apply(
  {
    get: (name) => (name === 'tools' ? { register: (definition) => { tool = definition; return () => {} } } : undefined),
    logger: { warn() {}, info() {}, debug() {} },
  },
  // This fuzz builds payloads for their content, not their provenance, and most
  // of them exceed the content-store limit. With the default in force every case
  // would return the same refusal, `stored.token` would be undefined, and the
  // run would report "no retrieval violations" while performing zero retrievals
  // — a clean result that is not evidence. The guard is exercised by its own
  // assertions in test/tool-contract.test.mjs.
  { contentStoreLimitChars: Number.MAX_SAFE_INTEGER, contentHintMinChars: Number.MAX_SAFE_INTEGER },
)

function rng(seed) {
  let state = (seed >>> 0) || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const failures = []
const fail = (seed, invariant, detail) => {
  failures.push({ seed, invariant, detail })
  if (failures.length <= 15) console.log('  FAIL seed=' + seed + ' [' + invariant + '] ' + detail)
}

/** Queries chosen to break a naive implementation. */
const QUERIES = [
  'connection reset',
  'not-present-anywhere-xyz',
  'ERROR',
  'error',
  'a.c',
  'abc',
  '(',
  ')',
  '[',
  '.*',
  '^2026',
  '$',
  '\\d+',
  'usr_0001',
  'person12@example.com',
  'heartbeat',
  '',
  ' ',
  '   ',
  'e',
  '中文',
  'ß',
  'a'.repeat(200),
  'CONNECTION RESET',
]

const storedCount = { value: 0 }
const attempts = { value: 0 }

for (let index = 0; index < COUNT; index += 1) {
  const seed = 1000 + index
  const random = rng(seed)

  // A payload with known, countable occurrences of the queries above.
  const lines = []
  for (let line = 0; line < 120; line += 1) {
    const roll = random()
    if (roll < 0.4) lines.push('2026-03-14T09:00:00.000Z DEBUG heartbeat seq=' + line)
    else if (roll < 0.6) lines.push('2026-03-14T09:00:01.000Z ERROR build failed: connection reset by peer')
    else if (roll < 0.7) lines.push('    at fn (/srv/app/x.js:' + (1000 + line) + ':1)')
    else if (roll < 0.8) lines.push('user person' + line + '@example.com active=true')
    else if (roll < 0.9) lines.push('abc and a.c and a-c all on one line ' + line)
    else lines.push('plain filler line ' + line + ' with nothing special')
  }
  const content = lines.join('\n')

  const stored = await tool.execute({ action: 'compress', content })
  if (stored.token === undefined) continue // refused; nothing to retrieve
  storedCount.value += 1

  // One query per payload, chosen by the same stream that shaped it, so the run
  // covers all 24 across the corpus without paying 24x the work per payload.
  const query = QUERIES[Math.floor(random() * QUERIES.length)]
  for (const limit of [undefined, 1, 3, 20, 0, -1]) {
    attempts.value += 1
    const args = { action: 'retrieve', token: stored.token, query }
    if (limit !== undefined) args.limit = limit

    let result
    try {
      result = await tool.execute(args)
    } catch (error) {
      fail(seed, 'query retrieval does not throw', JSON.stringify(query) + ' limit=' + limit + ': ' + String(error.message).slice(0, 60))
      continue
    }

    if (result.action === 'error') {
      fail(seed, 'query retrieval returns results, not an error', String(result.error).slice(0, 70) + ' query=' + JSON.stringify(query))
      continue
    }

    const regions = result.results
    if (!Array.isArray(regions)) {
      fail(seed, 'results is an array', typeof regions)
      continue
    }

    // 2. `literalMatches` must be exactly the number of regions that contain the
    // query text. This is the invariant that matters: it is the model's only way
    // to tell "your string is here" from "here is something related".
    if (query.trim() !== '') {
      const needle = query.toLowerCase()
      const containing = regions.filter(
        (region) => typeof region.text === 'string' && region.text.toLowerCase().includes(needle),
      ).length
      if (result.literalMatches !== containing) {
        fail(seed, 'literalMatches counts the regions that contain the query',
          JSON.stringify(query) + ': reported ' + result.literalMatches + ', actually ' + containing)
      }
    }

    // 3. limit is respected, and 0 means zero
    if (typeof limit === 'number' && limit >= 0 && regions.length > limit) {
      fail(seed, 'limit caps the regions', 'limit=' + limit + ' returned ' + regions.length)
    }
    if (limit === 0 && regions.length !== 0) {
      fail(seed, 'limit 0 returns nothing', regions.length + ' regions returned')
    }

    // 4. metacharacters are literals
    if (query === 'a.c') {
      const wrong = regions.filter((region) => region.text.includes('abc') && !region.text.includes('a.c'))
      if (wrong.length > 0 && result.literalMatches === regions.length) {
        fail(seed, 'regex metacharacter is literal in the query', JSON.stringify(wrong[0].text.slice(0, 60)))
      }
    }

    // 5. an absent query matches nothing, and says so
    if (query === 'not-present-anywhere-xyz' && regions.length !== 0) {
      fail(seed, 'an absent query matches nothing', regions.length + ' regions returned')
    }
    if (query === '中文' && regions.length !== 0 && !content.includes('中文')) {
      fail(seed, 'an absent unicode query matches nothing', regions.length + ' regions')
    }

    // 6. the counts agree with what came back, and never contradict each other
    if (typeof result.matched === 'number' && result.matched !== regions.length) {
      fail(seed, 'matched agrees with the returned regions', result.matched + ' vs ' + regions.length)
    }
    if (typeof result.literalMatches === 'number' && result.literalMatches > regions.length) {
      fail(seed, 'literalMatches never exceeds matched', result.literalMatches + ' > ' + regions.length)
    }

    // 1. retrieval does not mutate the store
    const whole = await tool.execute({ action: 'retrieve', token: stored.token })
    if (whole.original !== content) {
      fail(seed, 'retrieval leaves the stored original intact', 'differed after a query retrieve')
    }
  }
}

console.log('')
if (failures.length === 0) {
  console.log('no retrieval violations')
} else {
  const byInvariant = new Map()
  for (const entry of failures) byInvariant.set(entry.invariant, (byInvariant.get(entry.invariant) ?? 0) + 1)
  console.log(failures.length + ' violations:')
  for (const [invariant, count] of byInvariant) console.log('  ' + String(count).padStart(4) + '  ' + invariant)
  console.log('')
  console.log('replay: the payload is generated from seed ' + failures[0].seed)
}
console.log(storedCount.value + ' payloads stored, ' + attempts.value + ' retrieval calls, ' +
  QUERIES.length + ' distinct queries across the corpus')
console.log('(one query per payload, chosen by the same seeded stream that shaped it)')
process.exit(failures.length === 0 ? 0 : 1)

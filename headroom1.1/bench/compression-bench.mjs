/**
 * Measure the compression that actually ships.
 *
 * This does not reuse the test fixtures: it drives the INSTALLED host package
 * with content shaped like what a coding session really produces — a build log
 * with a stack trace, a bulk API response, a source file, a git diff, a long
 * document — and reports the token ratio for each.
 *
 * Token counts are reported twice, which is the point:
 *
 *   - `own`:   the engine's estimator, which prices identifier-ish ASCII near
 *              one token per 3 characters. It over-estimates, so the savings
 *              it reports are conservative.
 *   - `meter`: `@deepseek-ai/dsh-token-meter`'s `estimateContent`, the same
 *              heuristic the harness prices surfaces with.
 *
 * Agreement between the two matters more than either number: a ratio that only
 * exists under the tool's own estimator would be a claim, not a measurement.
 *
 * Run with: node bench/compression-bench.mjs
 */

import { createRequire } from 'node:module'
import { readFileSync, existsSync } from 'node:fs'
import { asUrl, paths, requireExistingPath } from '../dsh-paths.mjs'

const require = createRequire(import.meta.url)
// The package root exposes only the TokenMeter service; the pure heuristic the
// harness prices messages with is its `estimate` module.
const meter = await import(asUrl(requireExistingPath('meterEntry')))

const installedEntry = requireExistingPath('installedEntry')
const INSTALLED = asUrl(installedEntry)
const SOURCE = new URL('../index.js', import.meta.url).href

let passed = 0
let failed = 0
const check = (name, ok, detail) => {
  if (ok) {
    passed += 1
    console.log('  PASS  ' + name)
  } else {
    failed += 1
    console.log('  FAIL  ' + name + (detail === undefined ? '' : ' :: ' + detail))
  }
}

/** The harness's own pricing for a string, through a text block. */
const meterTokens = (text) => meter.estimateContent([{ type: 'text', text }])

// ── fixtures ────────────────────────────────────────────────────────────────

/** A debug log: repetitive heartbeats, a few real events, a stack trace. */
function buildLog() {
  const lines = []
  for (let index = 0; index < 400; index += 1) {
    const stamp = '2026-09-11T' + String(10 + (index % 3)).padStart(2, '0') + ':' + String(index % 60).padStart(2, '0') + ':00'
    lines.push(stamp + '.' + String(index % 1000).padStart(3, '0') + 'Z DEBUG pool.worker heartbeat seq=' + index + ' idle=3 queue=0 rss=48213kb')
  }
  lines.push('2026-09-11T13:04:11.201Z INFO  build.step compiling module graph (1284 modules)')
  lines.push('2026-09-11T13:04:19.884Z WARN  deprecation: `renderToString` is deprecated in favor of `renderToPipeableStream`')
  lines.push('2026-09-11T13:04:22.019Z ERROR build.step failed to bundle entry chunk: connection reset by peer')
  for (let index = 0; index < 14; index += 1) {
    lines.push('    at Object.resolve (/srv/app/node_modules/vite/dist/node/chunks/dep-8f1a2b3c.js:' + (12000 + index * 37) + ':' + (11 + index) + ')')
  }
  lines.push('2026-09-11T13:04:22.100Z INFO  build.step retrying in 250ms (attempt 1/3)')
  for (let index = 0; index < 200; index += 1) {
    lines.push('2026-09-11T13:04:' + String(30 + (index % 30)).padStart(2, '0') + '.000Z DEBUG retry.scheduler backoff attempt=' + index + ' wait=250ms')
  }
  return lines.join('\n')
}

/** A bulk API response: many records, most of the bulk in one long field. */
function buildJson() {
  const payload = {
    data: Array.from({ length: 120 }, (_, index) => ({
      id: 'usr_01H' + String(index).padStart(6, '0') + 'ABCDEF',
      object: 'user',
      created: 1793000000 + index * 37,
      email: 'person' + index + '@example.com',
      active: index % 7 !== 0,
      plan: index % 3 === 0 ? 'enterprise' : 'team',
      bio: 'A long profile biography for person number ' + index + ', describing their role, team, timezone and a great deal of other descriptive detail that no caller of this endpoint actually reads.',
      quota: { seats: 25 + index, used: index * 3, resetsAt: '2026-10-01T00:00:00Z' },
    })),
    has_more: true,
    next_cursor: 'cursor_eyJvZmZzZXQiOjEyMH0',
    total: 4218,
  }
  return JSON.stringify(payload, null, 2)
}

/** A source file with real bodies behind the signatures. */
function buildCode() {
  const parts = [
    "import { readFile, writeFile } from 'node:fs/promises'",
    "import { join, dirname } from 'node:path'",
    '',
    'const CACHE_TTL_MS = 60_000',
    'const MAX_ENTRIES = 512',
    '',
    'export interface CacheEntry {',
    '  key: string',
    '  value: unknown',
    '  expiresAt: number',
    '}',
    '',
    'export class Cache {',
    '  private entries = new Map<string, CacheEntry>()',
    '',
    '  constructor(private readonly ttlMs: number = CACHE_TTL_MS) {}',
    '',
    '  get(key: string): unknown | undefined {',
    '    const found = this.entries.get(key)',
    '    if (found === undefined) return undefined',
    '    if (found.expiresAt < Date.now()) {',
    '      this.entries.delete(key)',
    '      return undefined',
    '    }',
    '    return found.value',
    '  }',
    '',
  ]
  for (let index = 0; index < 40; index += 1) {
    parts.push('  compute' + index + '(input: number[]): number {')
    parts.push('    let total = 0')
    parts.push('    const weight = ' + (index + 1) + ' * 104729')
    parts.push('    const offset = weight % 8191')
    parts.push('    for (const value of input) {')
    parts.push('      if (value % 2 === 0) total += value * weight + offset')
    parts.push('      else total -= value - offset')
    parts.push('    }')
    parts.push('    return total % 1000003')
    parts.push('  }')
    parts.push('')
  }
  parts.push('  flush(): Promise<void> {')
  parts.push('    return writeFile(this.path, JSON.stringify([...this.entries.values()]))')
  parts.push('  }')
  parts.push('}')
  return parts.join('\n')
}

/** A diff with real churn. */
function buildDiff() {
  const parts = [
    'diff --git a/src/renderer.ts b/src/renderer.ts',
    'index 3f1a2b4..9c8d7e6 100644',
    'file-a/src/renderer.ts',
    'file-b/src/renderer.ts',
    '@@ -14,22 +14,26 @@ export class Renderer {',
  ]
  for (let index = 0; index < 60; index += 1) {
    parts.push('-  const previous = state.nodes[index] ?? fallbackNode(index)')
    parts.push('+  const previous = resolveNode(state, index, fallbackNode)')
  }
  parts.push('@@ -88,10 +92,12 @@ export class Renderer {')
  for (let index = 0; index < 60; index += 1) {
    parts.push('+  if (frame.dirty) scheduler.mark(frame.id, index)')
  }
  return parts.join('\n')
}

/** A document whose bulk is filler between headings. */
function buildDoc() {
  const parts = ['# Architecture decision record', '', 'Status: accepted. Date: 2026-09-11.', '']
  for (let index = 0; index < 30; index += 1) {
    parts.push('## Decision ' + index + ': ' + (index % 2 === 0 ? 'adopt' : 'reject') + ' the proposed approach')
    parts.push('')
    parts.push('The team considered the proposal at length during the review. It opens with the claim that the change reduces coupling between the modules under discussion. The middle of this section walks through supporting detail, prior art, benchmarks and a number of qualifications that a reader skimming for the decision does not need. It closes by restating the decision and the reasoning that carried it.')
    parts.push('')
    parts.push('Consequences: ' + 'the rollout proceeds behind a flag and is measured for one release cycle before the flag is removed. '.repeat(3))
    parts.push('')
  }
  return parts.join('\n')
}

const FIXTURES = [
  ['debug log', buildLog()],
  ['bulk JSON', buildJson()],
  ['source file', buildCode()],
  ['git diff', buildDiff()],
  ['document', buildDoc()],
]

// ── drive the installed plugin ──────────────────────────────────────────────

console.log('fixing the installed package')
console.log('  installed entry ' + installedEntry + '  [' + paths().installedEntrySource + ']')
check('installed package exists', existsSync(installedEntry))

const installed = await import(INSTALLED)
const source = await import(SOURCE)

/**
 * Mount one plugin copy against its own virtual `fs` and hand back a compressor.
 *
 * Each copy needs a private file map: two engines sharing one map would let the
 * second read the first's writes and agree for the wrong reason.
 */
function mount(plugin) {
  const files = new Map()
  const target = (path) => ({ targetKey: 'bench:' + path, displayPath: String(path) })
  let registered = null
  plugin.apply(
    {
      get: (name) => {
        if (name === 'tools') return { register: (definition) => { registered = definition; return () => {} } }
        if (name === 'fs') {
          return {
            resolve: async (path) => (files.has(String(path)) ? target(path) : undefined),
            readText: async (resolved) => files.get(String(resolved?.displayPath)),
            stat: async (resolved) => {
              const text = files.get(String(resolved?.displayPath))
              return text === undefined ? undefined : { type: 'file', size: text.length }
            },
          }
        }
        return undefined
      },
      logger: {},
    },
    {},
  )
  /* Compress through `path`, so the content-store guard never enters the picture:
     four of the five fixtures are past that limit, and their refusal is correct. */
  return {
    execute: (input) => registered.execute(input),
    compress: (label, content) => {
      const path = 'bench-virtual/' + label.replace(/[^A-Za-z0-9_.-]/g, '_')
      files.set(path, content)
      return registered.execute({ action: 'compress', path })
    },
  }
}

const installedTool = mount(installed)
const sourceTool = mount(source)

check('installed module registers the headroom tool', installedTool !== null)
check('source module registers its own tool', typeof sourceTool.compress === 'function')

const rows = []
console.log('\ncompressing\n')
console.log(
  '  ' + 'fixture'.padEnd(12) + 'kind'.padEnd(7) + 'chars'.padEnd(18) + 'own tokens'.padEnd(20) +
    'meter tokens'.padEnd(21) + 'saved (own)'.padEnd(13) + 'saved (meter)'.padEnd(14) + 'records kept',
)
console.log('  ' + '-'.repeat(122))

for (const [label, content] of FIXTURES) {
  const started = performance.now()
  const result = await installedTool.compress(label, content)
  const elapsed = performance.now() - started

  check(label + ': compressed', result.savedTokens > 0, String(result.note ?? ''))
  const back = await installedTool.execute({ action: 'retrieve', token: result.token })
  check(label + ': round trip is byte-exact', back.original === content)

  const ownBefore = result.originalTokens
  const ownAfter = result.compressedTokens
  const meterBefore = meterTokens(content)
  const meterAfter = meterTokens(result.compressed)

  const ownSaved = (100 * (ownBefore - ownAfter)) / ownBefore
  const meterSaved = (100 * (meterBefore - meterAfter)) / meterBefore

  // How many of the original's record identifiers are still readable? A
  // smaller payload that has thrown away most of its records is not an
  // improvement, so size is never reported without this.
  const idsOf = (text) => new Set([...text.matchAll(/[A-Za-z]*[_-]?[0-9]{3,}/g)].map((m) => m[0]))
  const before = idsOf(content)
  const after = idsOf(result.compressed)
  let kept = 0
  for (const id of before) if (after.has(id)) kept += 1
  const retention = before.size === 0 ? 'n/a' : ((100 * kept) / before.size).toFixed(0) + '%'

  rows.push({ label, kind: result.kind, ownBefore, ownAfter, meterBefore, meterAfter, ownSaved, meterSaved, charsBefore: content.length, charsAfter: result.compressed.length, elapsed, transforms: result.transforms, retention: before.size === 0 ? 1 : kept / before.size })

  console.log(
    '  ' +
      label.padEnd(12) +
      String(result.kind).padEnd(7) +
      (String(content.length) + ' -> ' + String(result.compressed.length)).padEnd(18) +
      (String(ownBefore) + ' -> ' + String(ownAfter)).padEnd(20) +
      (String(meterBefore) + ' -> ' + String(meterAfter)).padEnd(21) +
      (ownSaved.toFixed(1) + '%').padEnd(13) +
      (meterSaved.toFixed(1) + '%').padEnd(14) +
      retention,
  )
}

// ── totals ──────────────────────────────────────────────────────────────────

const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0)
const ownBefore = sum((row) => row.ownBefore)
const ownAfter = sum((row) => row.ownAfter)
const meterBefore = sum((row) => row.meterBefore)
const meterAfter = sum((row) => row.meterAfter)
const charsBefore = sum((row) => row.charsBefore)
const charsAfter = sum((row) => row.charsAfter)

console.log('\n  ' + '-'.repeat(104))
console.log('  ' + 'TOTAL'.padEnd(19) + (String(charsBefore) + ' -> ' + String(charsAfter)).padEnd(18) + (String(ownBefore) + ' -> ' + String(ownAfter)).padEnd(20) + (String(meterBefore) + ' -> ' + String(meterAfter)).padEnd(21) + (((100 * (ownBefore - ownAfter)) / ownBefore).toFixed(1) + '%').padEnd(13) + ((100 * (meterBefore - meterAfter)) / meterBefore).toFixed(1) + '%')

console.log('\n  labels: own = engine estimator, meter = dsh-token-meter estimateContent')

// ── the claims, as assertions ───────────────────────────────────────────────

console.log('\nclaims')
const ownTotalSaved = (100 * (ownBefore - ownAfter)) / ownBefore
const meterTotalSaved = (100 * (meterBefore - meterAfter)) / meterBefore
check('every fixture compressed', rows.length === FIXTURES.length)
check('total saving is material, by the engine estimator', ownTotalSaved > 50, ownTotalSaved.toFixed(1) + '%')
check('total saving is material, by the harness meter', meterTotalSaved > 50, meterTotalSaved.toFixed(1) + '%')
check(
  'the two estimators agree within 15 points',
  Math.abs(ownTotalSaved - meterTotalSaved) < 15,
  'own=' + ownTotalSaved.toFixed(1) + '% meter=' + meterTotalSaved.toFixed(1) + '%',
)
check('compression is not slow', sum((row) => row.elapsed) / rows.length < 50, (sum((row) => row.elapsed) / rows.length).toFixed(1) + ' ms/fixture')
check('every kind was exercised', new Set(rows.map((row) => row.kind)).size >= 4, rows.map((row) => row.kind).join(','))

// Structured data must keep every record. That is the property that separates
// this from a head/tail slicer: a payload may shrink, but not by dropping the
// rows the model was asked about.
const structured = rows.filter((row) => row.kind === 'json' || row.kind === 'diff')
check(
  'structured payloads keep every record',
  structured.every((row) => row.retention === 1),
  structured.map((row) => row.label + '=' + (row.retention * 100).toFixed(0) + '%').join(', '),
)

// Every stored original must still be exactly what went in.
console.log('\nlosslessness')
for (const [label, content] of FIXTURES) {
  const again = await installedTool.compress(label, content)
  const restored = await installedTool.execute({ action: 'retrieve', token: again.token })
  check(label + ': stored original is byte-identical', restored.original === content)
}

// Cost extrapolation, stated as arithmetic on the measured numbers.
console.log('\nwhat the saving means')
const perCall = meterBefore / rows.length
const savedPerCall = (meterBefore - meterAfter) / rows.length
console.log('  average input per fixture:   ' + Math.round(perCall) + ' tokens')
console.log('  average saved per fixture:   ' + Math.round(savedPerCall) + ' tokens')
console.log('  at 100 such compressions:    ' + Math.round(savedPerCall * 100).toLocaleString('en-US') + ' tokens kept out of context')
console.log('  at 1000 such compressions:   ' + Math.round(savedPerCall * 1000).toLocaleString('en-US') + ' tokens kept out of context')

// Cross-check: the source and the installed copy must behave identically, or
// the measurement describes a file nobody runs. Comparing the entry points being
// callable is not that check — two copies whose engine files have diverged would
// still pass it — so run every fixture through both and compare the output.
console.log('\nsource vs installed')
const differing = []
for (const [label, content] of FIXTURES) {
  const [fromInstalled, fromSource] = await Promise.all([
    installedTool.compress(label, content),
    sourceTool.compress(label, content),
  ])
  if (fromInstalled.compressed !== fromSource.compressed || fromInstalled.kind !== fromSource.kind) {
    differing.push(label + ' (installed ' + fromInstalled.compressed.length + ' vs source ' + fromSource.compressed.length + ' chars)')
  }
}
check(
  'the installed copy runs the same engine as the source',
  differing.length === 0,
  differing.length === 0 ? '' : 'stale install on ' + differing.length + '/' + FIXTURES.length + ' fixtures: ' + differing.join(', '),
)
if (differing.length > 0) {
  console.log('  note: the numbers above describe the INSTALLED copy, whose engine differs from the source.')
  console.log('        Reinstall before quoting them as what a session currently gets.')
}

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)

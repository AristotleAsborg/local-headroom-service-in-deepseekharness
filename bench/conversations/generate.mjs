/**
 * Generate the realistic test conversations the compression bench drives.
 *
 * These are not fixtures in the test sense: each file is the *shape of a payload
 * a DSH coding session really pulls into context* — a tool result, a file read,
 * a diff, a log tail, a search dump. That is the material headroom exists to
 * shrink, so measuring on it is measuring the thing that matters.
 *
 * Everything is deterministic: no randomness, no clock, no network. Re-running
 * this file reproduces byte-identical payloads, so a compression ratio quoted in
 * the README stays reproducible.
 *
 * Layout: one directory per conversation, one file per payload, plus an
 * `index.json` telling the bench how to read them.
 *
 * Run with: node bench/conversations/generate.mjs
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const INDEX = join(HERE, 'index.json')

// ── tiny deterministic helpers ──────────────────────────────────────────────

/** A reproducible 32-bit PRNG so "random-looking" data stays fixed. */
function rng(seed) {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

const WORDS = (
  'repository surface compaction threshold session projection snapshot registry budget token ' +
  'context window boundary checkpoint retention candidate region boundary surface event payload ' +
  'deterministic reversible structural heuristic estimator conservative skeleton identifier ' +
  'handler transform marker digest prefix suffix array object scalar nested subtree header tail ' +
  'sampling heartbeat retry backoff timeout queue worker scheduler lease fence epoch tombstone'
).split(' ')

/** Prose of roughly `words` words from a fixed vocabulary. */
function prose(random, words) {
  const out = []
  for (let index = 0; index < words; index += 1) {
    out.push(WORDS[Math.floor(random() * WORDS.length)])
  }
  return out.join(' ')
}

/** A sentence-shaped paragraph, so text handlers see real prose. */
function paragraph(random, sentences) {
  const parts = []
  for (let index = 0; index < sentences; index += 1) {
    const body = prose(random, 12 + Math.floor(random() * 12))
    parts.push(body.charAt(0).toUpperCase() + body.slice(1) + '.')
  }
  return parts.join(' ')
}

const hex = (random, length) =>
  Array.from({ length }, () => '0123456789abcdef'[Math.floor(random() * 16)]).join('')

const stamp = (baseSeconds, index) => {
  const second = baseSeconds + index
  const hh = String(9 + Math.floor(second / 3600)).padStart(2, '0')
  const mm = String(Math.floor(second / 60) % 60).padStart(2, '0')
  const ss = String(second % 60).padStart(2, '0')
  return '2026-03-14T' + hh + ':' + mm + ':' + ss + '.' + String((index * 137) % 1000).padStart(3, '0') + 'Z'
}

// ── payload builders, grouped by what a conversation was doing ───────────────

/** Conversation 1 — debugging a nightly build failure. */
function buildBuildFailure() {
  const random = rng(1001)
  const files = []

  // A CI log: thousands of repetitive lines, one real failure, one stack trace,
  // then a long retry storm. This is the classic "tool output nobody reads".
  const log = []
  for (let index = 0; index < 900; index += 1) {
    log.push(
      stamp(120 + index, index) +
        ' DEBUG pool.worker heartbeat seq=' + index +
        ' idle=' + (index % 4) + ' queue=' + (index % 3) +
        ' rss=' + (48000 + index * 7) + 'kb gc=' + (index % 11),
    )
  }
  for (let index = 0; index < 260; index += 1) {
    log.push(
      stamp(1200 + index, index) +
        ' DEBUG build.progress compiled ' + (40 + index) + '/1284 modules in ' + (120 + (index % 40)) + 'ms',
    )
  }
  log.push(stamp(1500, 0) + ' INFO  build.step resolving module graph (1284 modules, 92 externals)')
  log.push(stamp(1502, 1) + ' WARN  deprecation: `renderToString` is deprecated in favor of `renderToPipeableStream`')
  log.push(stamp(1503, 2) + ' WARN  chunk size: vendor.js is 812 KiB after minification (limit 600 KiB)')
  log.push(stamp(1506, 3) + ' ERROR build.step failed to bundle entry chunk "app": connection reset by peer')
  for (let index = 0; index < 18; index += 1) {
    log.push(
      '    at ' + ['Object.resolve', 'Module._compile', 'loadESM', 'bundleChunk'][index % 4] +
        ' (/srv/app/node_modules/vite/dist/node/chunks/dep-' + hex(random, 8) + '.js:' +
        (12000 + index * 37) + ':' + (11 + index) + ')',
    )
  }
  log.push(stamp(1507, 4) + ' ERROR build.step FATAL: bundle aborted, 1 entry chunk unrecoverable')
  for (let index = 0; index < 420; index += 1) {
    log.push(
      stamp(1508 + index, index) +
        ' DEBUG retry.scheduler backoff attempt=' + index + ' wait=' + (250 + index * 5) + 'ms target=registry.internal',
    )
  }
  log.push(stamp(1930, 0) + ' INFO  build.step retry budget exhausted after 420 attempts (elapsed 6m52s)')
  files.push(['ci-build.log', 'log', log.join('\n')])

  // A test summary: lots of passing lines around a handful of failures.
  const tests = []
  tests.push('> vitest run --reporter=verbose')
  tests.push('')
  tests.push(' RUN  v3.1.4 /srv/app')
  tests.push('')
  for (let index = 0; index < 340; index += 1) {
    tests.push(' ✓ test/unit/module' + (index % 40) + '.test.ts > case ' + index + ' (' + (1 + (index % 60)) + 'ms)')
  }
  tests.push(' ❯ test/integration/build.test.ts > bundles the entry chunk')
  tests.push('   → expected 200 but received 502 (connection reset by peer)')
  tests.push(' ❯ test/integration/build.test.ts > retries twice then fails loudly')
  tests.push('   → expected 3 attempts, saw 420')
  tests.push('')
  tests.push(' Test Files  41 passed | 2 failed (43)')
  tests.push('      Tests  340 passed | 2 failed (342)')
  tests.push('   Duration  18.42s')
  files.push(['vitest-output.txt', 'log', tests.join('\n')])

  // The failing package's manifest, read wholesale.
  const manifest = {
    name: '@srv/app',
    version: '4.18.2',
    private: true,
    type: 'module',
    packageManager: 'pnpm@9.12.0',
    engines: { node: '>=20.11', pnpm: '>=9' },
    scripts: {},
    dependencies: {},
    devDependencies: {},
    pnpm: { overrides: {}, peerDependencyRules: { allowedVersions: {} } },
  }
  const deps = ['react', 'react-dom', 'vite', 'esbuild', 'rollup', 'typescript', 'zod', 'undici', 'ws', 'chokidar']
  for (const dep of deps) {
    manifest.dependencies[dep] = '^' + (18 + Math.floor(random() * 4)) + '.' + Math.floor(random() * 9) + '.' + Math.floor(random() * 9)
    manifest.scripts['task:' + dep] = 'node scripts/run.mjs --target ' + dep + ' --retries 3 --concurrency 8'
  }
  for (const dep of ['vitest', '@types/node', 'eslint', 'prettier']) {
    manifest.devDependencies[dep] = '^' + (3 + Math.floor(random() * 5)) + '.0.0'
  }
  for (const dep of deps.slice(0, 6)) {
    manifest.pnpm.overrides[dep] = 'link:../' + dep
    manifest.pnpm.peerDependencyRules.allowedVersions[dep] = '>=18'
  }
  files.push(['package.json', 'json', JSON.stringify(manifest, null, 2)])

  return files
}

/** Conversation 2 — paginating a REST API while writing an importer. */
function buildApiPagination() {
  const random = rng(2002)
  const files = []

  // First page: many nearly identical records, one long field carrying the bulk.
  const page = {
    object: 'list',
    url: '/v1/workspaces',
    has_more: true,
    next_cursor: 'cursor_' + hex(random, 24),
    data: Array.from({ length: 140 }, (_, index) => ({
      id: 'ws_01H' + String(index).padStart(6, '0') + hex(random, 6).toUpperCase(),
      object: 'workspace',
      created: 1793000000 + index * 37,
      name: 'workspace-' + index + '-' + WORDS[index % WORDS.length],
      region: ['us-east-1', 'eu-west-2', 'ap-northeast-1'][index % 3],
      plan: ['free', 'team', 'enterprise'][index % 3],
      seats: 5 + (index % 40),
      active: index % 7 !== 0,
      owner: { id: 'usr_' + hex(random, 10), email: 'owner' + index + '@example.com', verified: index % 2 === 0 },
      description:
        'Workspace number ' + index + ' exists to hold the pipelines, dashboards and alert rules for one product ' +
        'team, together with the retention policy, the on-call rotation and the incident history that the team ' +
        'agreed on during planning. Callers of this endpoint almost never read this field.',
      limits: { requestsPerMinute: 600 + index, storageGb: 20 + (index % 80), resetsAt: '2026-04-01T00:00:00Z' },
      tags: ['pipeline', 'team-' + (index % 12), 'env-' + ['prod', 'stage', 'dev'][index % 3]],
    })),
  }
  files.push(['workspaces-page-1.json', 'json', JSON.stringify(page, null, 2)])

  // A metrics dump: few keys, deep arrays of numbers — structure-heavy, not prose-heavy.
  const metrics = {
    metric: 'http_request_duration_seconds',
    granularity: 'minute',
    window: { from: '2026-03-14T00:00:00Z', to: '2026-03-14T06:00:00Z' },
    series: Array.from({ length: 180 }, (_, index) => ({
      route: '/v1/workspaces',
      method: ['GET', 'POST'][index % 2],
      status: [200, 200, 200, 429, 500][index % 5],
      p50: 12 + (index % 30),
      p95: 180 + (index % 220),
      p99: 640 + (index % 900),
      count: 4000 + index * 13,
      samples: Array.from({ length: 12 }, (_, inner) => 8 + ((index * 7 + inner * 13) % 400)),
    })),
  }
  files.push(['metrics-dump.json', 'json', JSON.stringify(metrics, null, 2)])

  // Error payloads the API returned during the run: short, but many.
  const errors = Array.from({ length: 60 }, (_, index) => ({
    request_id: 'req_' + hex(random, 16),
    status: [400, 401, 404, 429, 500, 503][index % 6],
    code: ['invalid_cursor', 'unauthenticated', 'not_found', 'rate_limited', 'internal_error', 'unavailable'][index % 6],
    message:
      'Request ' + index + ' was rejected because the cursor supplied by the client no longer refers to a valid ' +
      'page boundary; the importer must restart pagination from the beginning and must not skip records.',
    retry_after_ms: index % 6 === 3 ? 1200 + index * 10 : null,
    attempted_at: '2026-03-14T0' + (index % 6) + ':' + String(index % 60).padStart(2, '0') + ':00Z',
  }))
  files.push(['error-report.json', 'json', JSON.stringify({ errors, total: errors.length }, null, 2)])

  return files
}

/** Conversation 3 — refactoring a module behind a large diff. */
function buildRefactor() {
  const random = rng(3003)
  const files = []

  // Source the model read before editing: signatures matter, bodies do not.
  const code = [
    "import { randomUUID } from 'node:crypto'",
    "import { readFile, writeFile, mkdir } from 'node:fs/promises'",
    "import { join, dirname, resolve } from 'node:path'",
    '',
    'const DEFAULT_TTL_MS = 60_000',
    'const MAX_ENTRIES = 1_024',
    'const SWEEP_INTERVAL_MS = 5_000',
    '',
    '/** One cached value together with the metadata the sweeper needs. */',
    'export interface CacheEntry<T> {',
    '  key: string',
    '  value: T',
    '  expiresAt: number',
    '  hits: number',
    '  size: number',
    '}',
    '',
    'export interface CacheOptions {',
    '  ttlMs?: number',
    '  maxEntries?: number',
    '  sweepIntervalMs?: number',
    '  onEvict?: (key: string, reason: string) => void',
    '}',
    '',
    '/** A bounded, self-sweeping memo store used by the pipeline resolver. */',
    'export class StorageCache<T = unknown> {',
    '  private readonly entries = new Map<string, CacheEntry<T>>()',
    '  private readonly options: Required<CacheOptions>',
    '  private timer: NodeJS.Timeout | undefined',
    '  private evictions = 0',
    '',
    '  constructor(options: CacheOptions = {}) {',
    '    this.options = {',
    '      ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,',
    '      maxEntries: options.maxEntries ?? MAX_ENTRIES,',
    '      sweepIntervalMs: options.sweepIntervalMs ?? SWEEP_INTERVAL_MS,',
    '      onEvict: options.onEvict ?? (() => {}),',
    '    }',
    '  }',
    '',
  ]
  for (let index = 0; index < 45; index += 1) {
    code.push('  /** Stage ' + index + ' of the resolver pipeline. */')
    code.push('  stage' + index + '(input: readonly T[], weight: number): { kept: T[]; dropped: number } {')
    code.push('    const kept: T[] = []')
    code.push('    let dropped = 0')
    code.push('    const threshold = weight * ' + (104729 + index))
    code.push('    for (const item of input) {')
    code.push('      const score = (String(item).length * threshold) % 8191')
    code.push('      if (score >= ' + (index % 97) + ') {')
    code.push('        kept.push(item)')
    code.push('        this.entries.set(String(item) + ":" + ' + index + ', {')
    code.push('          key: String(item),')
    code.push('          value: item,')
    code.push('          expiresAt: Date.now() + this.options.ttlMs,')
    code.push('          hits: 0,')
    code.push('          size: 1,')
    code.push('        })')
    code.push('      } else {')
    code.push('        dropped += 1')
    code.push('        this.evictions += 1')
    code.push('        this.options.onEvict(String(item), "score")')
    code.push('      }')
    code.push('    }')
    code.push('    return { kept, dropped }')
    code.push('  }')
    code.push('')
  }
  code.push('  /** Persist the live entries so a restart warms from disk. */')
  code.push('  async flush(path: string): Promise<{ written: number; bytes: number }> {')
  code.push('    await mkdir(dirname(path), { recursive: true })')
  code.push('    const payload = JSON.stringify([...this.entries.values()], null, 2)')
  code.push('    await writeFile(path, payload, "utf8")')
  code.push('    return { written: this.entries.size, bytes: payload.length }')
  code.push('  }')
  code.push('}')
  files.push(['src/cache.ts', 'code', code.join('\n')])

  // The diff: two hunks of real churn, plus a third that is pure rename noise.
  const diff = ['diff --git a/src/resolver.ts b/src/resolver.ts', 'index ' + hex(random, 7) + '..' + hex(random, 7) + ' 100644', 'file-a/src/resolver.ts', 'file-b/src/resolver.ts']
  diff.push('@@ -14,28 +14,34 @@ export class Resolver {')
  for (let index = 0; index < 70; index += 1) {
    diff.push('-  const previous = state.nodes[index] ?? fallbackNode(index)')
    diff.push('+  const previous = resolveNode(state, index, fallbackNode)')
  }
  diff.push('@@ -96,12 +102,18 @@ export class Resolver {')
  for (let index = 0; index < 55; index += 1) {
    diff.push('+  if (frame.dirty) scheduler.mark(frame.id, ' + index + ')')
  }
  diff.push('@@ -180,20 +192,20 @@ export class Resolver {')
  for (let index = 0; index < 40; index += 1) {
    diff.push('-import { legacyResolve } from "./legacy"')
    diff.push('+import { legacyResolve } from "./compat/legacy"')
  }
  files.push(['resolver.diff', 'diff', diff.join('\n')])

  // Search results: grep-shaped output, mostly matches with long paths.
  const search = []
  for (let index = 0; index < 210; index += 1) {
    search.push(
      'src/' + ['pipeline', 'resolver', 'cache', 'schema'][index % 4] + '/module' + (index % 60) + '.ts:' +
        (10 + index * 3) + ':  const value = resolveNode(state, ' + index + ', fallbackNode)',
    )
  }
  search.push('src/resolver/legacy.ts:412:  // TODO(2026-01): delete once compat/legacy is gone')
  files.push(['grep-resolveNode.txt', 'lines', search.join('\n')])

  return files
}

/** Conversation 4 — onboarding: mapping a repository from listings and docs. */
function buildOnboarding() {
  const random = rng(4004)
  const files = []

  // A recursive listing: same prefix repeated on every line.
  const listing = ['packages/app:' ]
  for (let index = 0; index < 420; index += 1) {
    const dir = ['src/features', 'src/components', 'src/hooks', 'src/lib', 'test/unit', 'test/e2e'][index % 6]
    listing.push('packages/app/' + dir + '/module' + String(index).padStart(3, '0') + '.' + (index % 3 === 0 ? 'tsx' : 'ts'))
  }
  listing.push('packages/app/package.json')
  listing.push('packages/app/tsconfig.json')
  files.push(['repo-listing.txt', 'lines', listing.join('\n')])

  // The architecture doc: prose whose middle is filler between headings.
  const doc = ['# Architecture overview', '', 'Status: accepted. Owners: platform. Updated: 2026-03-14.', '']
  for (let index = 0; index < 34; index += 1) {
    doc.push('## ' + (index + 1) + '. ' + WORDS[(index * 3) % WORDS.length].charAt(0).toUpperCase() + WORDS[(index * 3) % WORDS.length].slice(1) + ' and the ' + WORDS[(index * 5 + 2) % WORDS.length] + ' boundary')
    doc.push('')
    doc.push(paragraph(random, 4))
    doc.push('')
    doc.push('Consequences: ' + paragraph(random, 2))
    doc.push('')
    doc.push('```')
    doc.push('surface -> projection -> ' + WORDS[(index * 7) % WORDS.length] + ' -> checkpoint')
    doc.push('```')
    doc.push('')
  }
  files.push(['docs/architecture.md', 'text', doc.join('\n')])

  // A lockfile-shaped document: the same key set repeated once per package.
  const lock = {
    lockfileVersion: 9,
    settings: { autoInstallPeers: true, excludeLinksFromLockfile: false },
    importers: {
      '.': {
        dependencies: Object.fromEntries(
          Array.from({ length: 60 }, (_, index) => [
            '@srv/' + WORDS[index % WORDS.length] + '-' + index,
            { specifier: '^' + (1 + (index % 5)) + '.' + (index % 20) + '.0', version: (1 + (index % 5)) + '.' + (index % 20) + '.' + (index % 9) },
          ]),
        ),
      },
    },
    packages: Object.fromEntries(
      Array.from({ length: 90 }, (_, index) => {
        const name = '/@srv/' + WORDS[(index * 2) % WORDS.length] + '-' + index + '@' + (1 + (index % 5)) + '.' + (index % 20) + '.0'
        return [
          name,
          {
            resolution: { integrity: 'sha512-' + hex(random, 64) },
            engines: { node: '>=20' },
            peerDependencies: { react: '>=18' },
            dev: index % 2 === 0,
            hasBin: index % 7 === 0,
          },
        ]
      }),
    ),
  }
  files.push(['pnpm-lock.yaml', 'json', JSON.stringify(lock, null, 2)])

  return files
}

/** Conversation 5 — triaging a flaky end-to-end run. */
function buildFlakyE2E() {
  const random = rng(5005)
  const files = []

  // Playwright-style output: many green steps, a few real failures, then retries.
  const run = ['$ npx playwright test --workers=4 --retries=2', '']
  for (let index = 0; index < 280; index += 1) {
    run.push('  ✓  ' + (index + 1) + ' e2e/specs/flow' + (index % 36) + '.spec.ts:' + (20 + index) + ' › completes step ' + index + ' (' + (400 + (index % 2400)) + 'ms)')
  }
  run.push('  ✘  ' + 281 + ' e2e/specs/checkout.spec.ts:88 › submits the order')
  run.push('       TimeoutError: locator.click: Timeout 30000ms exceeded waiting for getByRole("button", { name: "Pay now" })')
  run.push('       at e2e/specs/checkout.spec.ts:88:24')
  run.push('  ✘  ' + 282 + ' e2e/specs/checkout.spec.ts:104 › retries the payment')
  run.push('       Error: expect(received).toBe(expected) — expected 1 attempt, received 3')
  for (let index = 0; index < 90; index += 1) {
    run.push('  ⟳  retry ' + (index % 3) + ' e2e/specs/flow' + (index % 36) + '.spec.ts:' + (20 + index) + ' — retrying after ' + (500 + index * 10) + 'ms backoff')
  }
  run.push('')
  run.push('  2 failed, 278 passed, 4 flaky (34.2s)')
  files.push(['playwright-run.txt', 'lines', run.join('\n')])

  // A browser console / network dump: JSON records with repeated keys.
  const network = {
    capturedAt: '2026-03-14T09:41:02.118Z',
    entries: Array.from({ length: 110 }, (_, index) => ({
      startedDateTime: '2026-03-14T09:' + String(40 + (index % 2)).padStart(2, '0') + ':' + String(index % 60).padStart(2, '0') + '.000Z',
      request: {
        method: ['GET', 'POST'][index % 2],
        url: 'https://app.example.com/api/v1/' + ['orders', 'payments', 'customers'][index % 3] + '?page=' + index,
        headers: { accept: 'application/json', 'x-request-id': 'req_' + hex(random, 12) },
      },
      response: { status: [200, 200, 201, 409, 500][index % 5], bodySize: 512 + index * 37, timeMs: 20 + (index % 900) },
      cache: { hit: index % 4 === 0, ageSeconds: (index * 3) % 120 },
      timing: { dns: index % 30, connect: index % 40, ssl: index % 50, send: 1, wait: 10 + (index % 400), receive: 2 + (index % 90) },
    })),
    summary: { requests: 110, failures: 22, slowestMs: 919, totalBytes: 1840000 },
  }
  files.push(['network-har.json', 'json', JSON.stringify(network, null, 2)])

  // The spec that fails, read whole, with long test bodies.
  const spec = [
    "import { test, expect } from '@playwright/test'",
    "import { CheckoutPage } from '../pages/checkout'",
    '',
    "test.describe('checkout', () => {",
    "  test.beforeEach(async ({ page }) => {",
    "    await page.goto('/checkout')",
    "  })",
    '',
  ]
  for (let index = 0; index < 38; index += 1) {
    spec.push("  test('submits order variant " + index + "', async ({ page }) => {")
    spec.push('    const checkout = new CheckoutPage(page)')
    spec.push('    await checkout.fillAddress({ street: "1 Example St", city: "Springfield", zip: "0' + (1000 + index) + '" })')
    spec.push('    await checkout.fillPayment({ card: "4242424242424242", expiry: "12/29", cvc: "123" })')
    spec.push('    await expect(checkout.payButton).toBeEnabled({ timeout: ' + (5000 + index * 100) + ' })')
    spec.push('    await checkout.payButton.click()')
    spec.push('    await expect(page.getByRole("heading", { name: "Order confirmed" })).toBeVisible()')
    spec.push('    await expect(page.getByTestId("order-id")).toContainText("ord_")')
    spec.push('  })')
    spec.push('')
  }
  spec.push('})')
  files.push(['e2e/specs/checkout.spec.ts', 'code', spec.join('\n')])

  return files
}

/** Conversation 6 — reading a long spec before implementing it. */
function buildSpecReading() {
  const random = rng(6006)
  const files = []

  const spec = ['# Compaction and context budget — protocol specification', '', 'Version 3. Draft. Editors: platform, runtime.', '']
  for (let index = 0; index < 40; index += 1) {
    spec.push('## ' + (index + 1) + '. ' + WORDS[(index * 11) % WORDS.length].toUpperCase() + ' requirement')
    spec.push('')
    spec.push(paragraph(random, 5))
    spec.push('')
    spec.push('| field | type | required | notes |')
    spec.push('| --- | --- | --- | --- |')
    for (let row = 0; row < 6; row += 1) {
      spec.push('| ' + WORDS[(index + row) % WORDS.length] + '_' + row + ' | ' + ['string', 'number', 'boolean', 'array'][row % 4] + ' | ' + (row % 2 === 0) + ' | ' + paragraph(random, 1) + ' |')
    }
    spec.push('')
    spec.push(paragraph(random, 6))
    spec.push('')
  }
  files.push(['spec/compaction-protocol.md', 'text', spec.join('\n')])

  // A conformance-vector JSON: repetitive, deeply nested, key-dominant.
  const vectors = {
    suite: 'compaction-protocol',
    version: 3,
    vectors: Array.from({ length: 80 }, (_, index) => ({
      id: 'vec-' + String(index).padStart(3, '0'),
      description: 'Vector ' + index + ' asserts that a surface cut at an unanswered tool call is rejected.',
      input: {
        events: Array.from({ length: 5 }, (_, inner) => ({
          seq: inner + 1,
          type: ['user/message', 'assistant/message', 'tool/result'][inner % 3],
          surfaceOp: 'append',
          payload: { text: prose(random, 14), tokens: 40 + inner * 7 },
        })),
      },
      expect: { accepted: index % 5 !== 0, reason: index % 5 === 0 ? 'tool-pairing-unbalanced' : 'ok', resultingTokens: 200 + index * 3 },
    })),
  }
  files.push(['spec/conformance-vectors.json', 'json', JSON.stringify(vectors, null, 2)])

  return files
}

// ── conversation roster ─────────────────────────────────────────────────────

const CONVERSATIONS = [
  {
    id: 'conv-01-build-failure',
    title: 'Debugging a nightly CI build failure',
    turns: [
      { role: 'user', text: 'The nightly build failed. Can you find out why and fix it?' },
      { role: 'assistant', text: 'Reading the CI log first — it is long, so I will compress before reasoning over it.' },
      { role: 'user', text: 'Fine, but do not lose the failing line.' },
      { role: 'assistant', text: 'The failure is a connection reset while bundling the entry chunk, followed by 420 retry attempts that all failed.' },
    ],
    builds: buildBuildFailure,
  },
  {
    id: 'conv-02-api-pagination',
    title: 'Writing an importer against a paginated API',
    turns: [
      { role: 'user', text: 'Write the workspaces importer and make it tolerate rate limits.' },
      { role: 'assistant', text: 'I will pull one page plus the metrics and error report to see the real shapes.' },
      { role: 'user', text: 'How many records per page and what is the retry signal?' },
      { role: 'assistant', text: '140 records per page, cursor-based; rate limits arrive as 429 with retry_after_ms.' },
    ],
    builds: buildApiPagination,
  },
  {
    id: 'conv-03-refactor',
    title: 'Refactoring the resolver behind a large diff',
    turns: [
      { role: 'user', text: 'Move the resolver onto the new node API, then show me the diff.' },
      { role: 'assistant', text: 'Reading the module and the search results that reference resolveNode.' },
      { role: 'user', text: 'That diff is mostly renames — how much is real?' },
      { role: 'assistant', text: 'Two hunks are real behaviour changes; the third is 40 identical import rewrites.' },
    ],
    builds: buildRefactor,
  },
  {
    id: 'conv-04-onboarding',
    title: 'Mapping an unfamiliar repository',
    turns: [
      { role: 'user', text: 'I am new to this repo. Tell me how it is organized.' },
      { role: 'assistant', text: 'Listing the tree, then reading the architecture doc and the lockfile.' },
      { role: 'user', text: 'Which packages are direct dependencies?' },
      { role: 'assistant', text: 'Sixty direct dependencies, all under the @srv scope, mirrored by 90 locked packages.' },
    ],
    builds: buildOnboarding,
  },
  {
    id: 'conv-05-flaky-e2e',
    title: 'Triaging a flaky end-to-end run',
    turns: [
      { role: 'user', text: 'Checkout spec is flaky in CI again. Why?' },
      { role: 'assistant', text: 'Pulling the Playwright run, the network capture and the spec itself.' },
      { role: 'user', text: 'Is it the test or the application?' },
      { role: 'assistant', text: 'The pay button is never enabled: the payments call returns 500 in the capture, and the spec retries three times.' },
    ],
    builds: buildFlakyE2E,
  },
  {
    id: 'conv-06-spec-reading',
    title: 'Reading a long protocol spec before implementing it',
    turns: [
      { role: 'user', text: 'Implement the compaction protocol from the spec.' },
      { role: 'assistant', text: 'Compressing the spec and the conformance vectors before reading them properly.' },
      { role: 'user', text: 'How many vectors must reject?' },
      { role: 'assistant', text: 'Sixteen of eighty: every fifth vector is tool-pairing-unbalanced and must be rejected.' },
    ],
    builds: buildSpecReading,
  },
]

// ── emit ────────────────────────────────────────────────────────────────────

if (existsSync(INDEX)) rmSync(INDEX)

const manifest = []
let totalFiles = 0
let totalChars = 0

for (const conversation of CONVERSATIONS) {
  const dir = join(HERE, conversation.id)
  mkdirSync(dir, { recursive: true })

  const payloads = []
  for (const [name, kind, content] of conversation.builds()) {
    const file = join(dir, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content, 'utf8')
    payloads.push({ name, kind, chars: content.length, lines: content.split('\n').length })
    totalFiles += 1
    totalChars += content.length
  }

  manifest.push({
    id: conversation.id,
    title: conversation.title,
    turns: conversation.turns,
    payloads,
  })

  console.log(
    '  ' + conversation.id.padEnd(24) + String(payloads.length).padStart(2) + ' payloads  ' +
      String(payloads.reduce((sum, entry) => sum + entry.chars, 0)).padStart(9) + ' chars',
  )
}

writeFileSync(INDEX, JSON.stringify({ generatedBy: 'generate.mjs', conversations: manifest }, null, 2) + '\n', 'utf8')

console.log('')
console.log('  ' + String(CONVERSATIONS.length) + ' conversations, ' + totalFiles + ' payloads, ' + totalChars.toLocaleString('en-US') + ' chars')
console.log('  index: ' + INDEX)

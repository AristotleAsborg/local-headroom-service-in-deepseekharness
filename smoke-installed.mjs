/**
 * Smoke-test the INSTALLED copy, importing it by absolute path.
 *
 * Why not by package name: this workspace declares the same package name as the
 * installed copy (`headroom/package.json` -> "dsh-plugin-headroom"), and a
 * module inside the workspace resolves a bare name to itself. Importing the
 * installed file by its real path is the only way to be sure which copy is
 * under test.
 *
 * Which real path is not hardcoded: `dsh-paths.mjs` resolves it, and prints the
 * source of its answer when the resolution fails. `install.mjs --dry-run`
 * separately proves the repository and installed copies are identical byte for
 * byte.
 *
 * Run with: node smoke-installed.mjs [--dsh-home <path>] [--profile <name>]
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/**
 * Load `dsh-paths.mjs` from wherever this file has been placed.
 *
 * The repository keeps the resolver at its root; the install package copies it
 * beside the plugin as well. Trying both means one unchanged file works as
 * `headroom/smoke-installed.mjs`, as `<install root>/smoke-installed.mjs`, and
 * as `<install root>/plugin/smoke-installed.mjs` — which is what makes
 * "re-verify the installed copy in place" possible on a machine that never had
 * this checkout.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const RESOLVER_CANDIDATES = [
  join(HERE, 'dsh-paths.mjs'),
  join(HERE, 'plugin', 'dsh-paths.mjs'),
  join(HERE, '..', 'dsh-paths.mjs'),
]
const resolverPath = RESOLVER_CANDIDATES.find((candidate) => existsSync(candidate))
if (resolverPath === undefined) {
  console.error('cannot find dsh-paths.mjs. Looked in:')
  for (const candidate of RESOLVER_CANDIDATES) console.error('  ' + candidate)
  process.exit(1)
}
const { asUrl, paths, requireExistingPath } = await import(pathToFileURL(resolverPath).href)

const resolved = paths()
const require = createRequire(import.meta.url)

const meterEntry = requireExistingPath('meterEntry')
const toolsEntry = requireExistingPath('toolsEntry')
const installedEntry = requireExistingPath('installedEntry')

const meter = await import(asUrl(meterEntry))
const tools = require(toolsEntry)

console.log('installed entry -> ' + installedEntry)
console.log('  resolved from  ' + resolved.installedEntrySource)
console.log('  runtime        ' + resolved.runtimeRoot + ' [' + resolved.runtimeRootSource + ']')

const plugin = await import(asUrl(installedEntry))
let definition = null
plugin.apply(
  {
    get: (name) => (name === 'tools' ? { register: (d) => { definition = d; return () => {} } } : undefined),
    logger: {},
  },
  { ttlMinutes: 60, storeMax: 256 },
)

if (definition === null) {
  console.error('FAIL: the installed module registered no tool')
  process.exit(1)
}

// The three checks the registry itself performs at mount.
tools.assertSupportedJsonSchema(definition.output.schema)
console.log('tool registered  : ' + definition.name)
console.log('output schema    : accepted by assertSupportedJsonSchema')
console.log('render           : ' + typeof definition.output.render)

const fixtures = {
  'build log': [
    ...Array.from({ length: 300 }, (_, i) => '2026-09-11T13:0' + (i % 10) + ':00.000Z DEBUG heartbeat seq=' + i + ' idle=3 queue=' + (i % 4)),
    '2026-09-11T13:04:22.019Z ERROR build failed: connection reset by peer',
    '    at Object.resolve (/srv/app/vite/dist/node/chunks/dep-8f1a2b3c.js:12037:12)',
    '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
  ].join('\n'),
  'api response': JSON.stringify({
    data: Array.from({ length: 60 }, (_, i) => ({
      id: 'usr_01H' + String(i).padStart(6, '0'),
      email: 'person' + i + '@example.com',
      bio: 'A long profile biography for person number ' + i + ', describing role, team, timezone and a great deal of other descriptive detail no caller reads.',
      active: i % 5 !== 0,
    })),
    total: 60,
  }, null, 2),
  'source file': [
    'export class Cache {',
    ...Array.from({ length: 12 }, (_, i) => [
      '  compute' + i + '(input: number[]): number {',
      '    let total = 0',
      '    const weight = ' + (i + 1) + ' * 104729',
      '    for (const value of input) {',
      '      if (value % 2 === 0) total += value * weight',
      '      else total -= value',
      '    }',
      '    return total % 1000003',
      '  }',
      '',
    ]).flat(),
    '}',
  ].join('\n'),
}

let totalIn = 0
let totalOut = 0
let failures = 0
console.log('\n  fixture        kind   meter tokens        saved')
console.log('  ' + '-'.repeat(54))

for (const [label, content] of Object.entries(fixtures)) {
  const result = await definition.execute({ action: 'compress', content })
  if (result.token === undefined) {
    console.log('  ' + label.padEnd(15) + 'REFUSED: ' + String(result.note))
    failures += 1
    continue
  }
  const before = meter.estimateContent([{ type: 'text', text: content }])
  const after = meter.estimateContent([{ type: 'text', text: result.compressed }])
  totalIn += before
  totalOut += after
  console.log(
    '  ' + label.padEnd(15) + String(result.kind).padEnd(7) +
      (before + ' -> ' + after).padEnd(20) +
      ((100 * (before - after)) / before).toFixed(1) + '%',
  )

  const back = await definition.execute({ action: 'retrieve', token: result.token })
  if (back.original !== content) {
    console.error('  FAIL: ' + label + ' round trip is not byte-exact')
    failures += 1
  }
  if (!definition.output.render({ action: 'compress' }, result)[0].text.includes(result.token)) {
    console.error('  FAIL: ' + label + ' rendered text lost the token')
    failures += 1
  }
  const queried = await definition.execute({ action: 'retrieve', token: result.token, query: 'example.com' })
  if (!Array.isArray(queried.results)) {
    console.error('  FAIL: ' + label + ' query retrieve did not return regions')
    failures += 1
  }
}

console.log('  ' + '-'.repeat(54))
console.log(
  '  TOTAL          meter tokens ' + totalIn + ' -> ' + totalOut + '  =  ' +
    ((100 * (totalIn - totalOut)) / totalIn).toFixed(1) + '% saved',
)
console.log('\nall fixtures: byte-exact round trip, rendered text carries the token, query retrieve works')

const stats = await definition.execute({ action: 'stats' })
console.log(
  'stats: ' + stats.compressions + ' compressions, ' + stats.retrievals + ' retrievals, ' +
    stats.tokensSaved + ' tokens saved (' + stats.savingsPercent + '%), ' +
    stats.storedEntries + ' entries retrievable',
)

process.exit(failures === 0 ? 0 : 1)

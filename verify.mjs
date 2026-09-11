#!/usr/bin/env node
/**
 * Verify an INSTALLED headroom: load it by absolute path and exercise it.
 *
 * Why not by package name: a bare name resolves from this script's own
 * location, and if a source checkout with the same package name sits nearby it
 * would resolve to that instead — testing the wrong copy. The absolute path is
 * the only way to be sure which bytes are under test.
 *
 * Usage:
 *   node verify.mjs                                  # auto-detect via DSH_HOME
 *   node verify.mjs --entry <path-to-plugin/index.js>
 *   node verify.mjs --home <path-to-DSH_HOME>
 */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'

const argv = process.argv.slice(2)
const valueOf = (flag) => {
  const at = argv.indexOf(flag)
  return at >= 0 ? argv[at + 1] : undefined
}

const dshHome = valueOf('--home') ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
const entry =
  valueOf('--entry') ?? join(dshHome, 'profiles', 'node_modules', 'dsh-plugin-headroom', 'plugin', 'index.js')

console.log('verifying ' + resolve(entry))
if (!existsSync(entry)) {
  console.error('\nNo plugin at that path. Install first, or pass --entry / --home.')
  process.exit(1)
}

const plugin = await import('file:///' + resolve(entry).replace(/\\/g, '/'))
let definition = null
plugin.apply(
  {
    get: (name) => (name === 'tools' ? { register: (d) => { definition = d; return () => {} } } : undefined),
    logger: {},
  },
  { ttlMinutes: 60, storeMax: 256 },
)

let failures = 0
const check = (name, ok, detail) => {
  if (ok) {
    console.log('  PASS  ' + name)
  } else {
    failures += 1
    console.log('  FAIL  ' + name + (detail === undefined ? '' : ' :: ' + detail))
  }
}

console.log('\nregistration')
check('exports apply', typeof plugin.apply === 'function')
check('registers the headroom tool', definition !== null && definition.name === 'headroom')
check('declares output before rendering', definition !== null && typeof definition.output?.render === 'function')
check('output schema is a JSON object', definition !== null && definition.output?.schema?.type === 'object')

const fixtures = {
  log: [
    ...Array.from({ length: 300 }, (_, i) => '2026-09-11T13:0' + (i % 10) + ':00.000Z DEBUG heartbeat seq=' + i + ' idle=3'),
    '2026-09-11T13:04:22.019Z ERROR build failed: connection reset by peer',
    '    at Object.resolve (/srv/app/vite/dist/node/chunks/dep-8f1a2b3c.js:12037:12)',
  ].join('\n'),
  json: JSON.stringify({
    data: Array.from({ length: 60 }, (_, i) => ({
      id: 'usr_01H' + String(i).padStart(6, '0'),
      email: 'person' + i + '@example.com',
      bio: 'A long profile biography for person number ' + i + ', describing role, team and timezone in more detail than any caller reads.',
      active: i % 5 !== 0,
    })),
    total: 60,
  }, null, 2),
  code: [
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

console.log('\ncompression')
let before = 0
let after = 0
for (const [label, content] of Object.entries(fixtures)) {
  const result = await definition.execute({ action: 'compress', content })
  if (result.token === undefined) {
    check(label + ' compresses', false, String(result.note))
    continue
  }
  before += result.originalTokens
  after += result.compressedTokens

  const restored = await definition.execute({ action: 'retrieve', token: result.token })
  check(label + ': round trip is byte-exact', restored.original === content)
  check(
    label + ': rendered text carries the token',
    definition.output.render({ action: 'compress' }, result)[0].text.includes(result.token),
  )
  const queried = await definition.execute({ action: 'retrieve', token: result.token, query: 'example.com' })
  check(label + ': query retrieve returns regions', Array.isArray(queried.results))
  console.log(
    '        ' + label.padEnd(6) + String(result.originalTokens) + ' -> ' + String(result.compressedTokens) +
      ' tokens (' + result.savedPercent + '% saved, kind=' + result.kind + ')',
  )
}

console.log('\n' + ((100 * (before - after)) / before).toFixed(1) + '% saved across the samples')
const stats = await definition.execute({ action: 'stats' })
console.log('stats: ' + stats.compressions + ' compressions, ' + stats.retrievals + ' retrievals, ' + stats.tokensSaved + ' tokens saved')
console.log('\n' + (failures === 0 ? 'all checks passed' : failures + ' check(s) failed'))
process.exit(failures === 0 ? 0 : 1)

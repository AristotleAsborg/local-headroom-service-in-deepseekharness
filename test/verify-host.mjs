/**
 * Verify the always-on host-plane installation.
 *
 * The host row is what makes `headroom` available in every session, whatever
 * preset it uses. Three things have to hold: the profile patch layer still
 * parses with the row appended, the package name resolves from the base a host
 * row actually loads from, and the resolved module registers a valid tool.
 *
 * Every path comes from `dsh-paths.mjs`, which reproduces the harness's own
 * upward `node_modules` walk instead of asserting a literal layout. This suite
 * therefore checks the installation on whatever machine it runs on, rather than
 * on the machine it was written on.
 *
 * Run with: node test/verify-host.mjs [--dsh-home <path>] [--profile <name>]
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { PACKAGE_NAME, paths, requireExistingPath } from '../dsh-paths.mjs'

const layout = paths()
const require = createRequire(import.meta.url)

const yamlRoot = requireExistingPath('yamlEntry')
const toolsEntry = requireExistingPath('toolsEntry')
const yaml = require(yamlRoot)
const tools = require(toolsEntry)

const PROFILE_ROOT = requireExistingPath('profileRoot')
const PACKAGE_PARENT = requireExistingPath('packageParent')
const PATCH = join(PROFILE_ROOT, 'cordis.patch.yml')
const PACKAGE_ROOT = join(PACKAGE_PARENT, 'node_modules', PACKAGE_NAME)

let passed = 0
let failed = 0
const check = (name, ok, detail) => {
  if (ok) {
    passed += 1
    console.log('  PASS  ' + name)
  } else {
    failed += 1
    console.log('  FAIL  ' + name + (detail === undefined ? '' : '\n        ' + detail))
  }
}

console.log('\nresolved layout')
console.log('  profile        ' + layout.profile)
console.log('  PROFILE_ROOT   ' + PROFILE_ROOT + '  [' + layout.profileRootSource + ']')
console.log('  PACKAGE_PARENT ' + PACKAGE_PARENT + '  [' + layout.packageParentSource + ']')
console.log('  runtime        ' + layout.runtimeRoot + '  [' + layout.runtimeRootSource + ']')

// ── the patch layer parses, with the existing rows intact ───────────────────

console.log('\nprofile patch layer')
check('patch file exists', existsSync(PATCH))
const loaderSchema = yaml.DEFAULT_SCHEMA.extend([
  new yaml.Type('tag:yaml.org,2002:js', { kind: 'scalar', construct: (value) => ({ __js: value }) }),
])
let document = null
let parseError = null
try {
  document = yaml.load(readFileSync(PATCH, 'utf8'), { schema: loaderSchema })
} catch (error) {
  parseError = error
}
check('patch layer parses in the loader dialect', parseError === null, parseError === null ? '' : String(parseError?.message))
check('root is an array', Array.isArray(document))

// `- insert: [ ... ]` is how this profile adds rows; collect every id present.
const ids = []
for (const entry of Array.isArray(document) ? document : []) {
  for (const row of entry?.insert ?? []) {
    if (typeof row?.id === 'string') ids.push(row.id)
  }
}
console.log('        registered ids: ' + ids.join(', '))
check('the previous row survived', ids.includes('token-balance'), ids.join(', '))
check('the headroom row is present', ids.includes('headroom'), ids.join(', '))
check('no duplicate ids', new Set(ids).size === ids.length)

const headroomRow = (Array.isArray(document) ? document : [])
  .flatMap((entry) => entry?.insert ?? [])
  .find((row) => row?.id === 'headroom')
check('headroom row names the package', headroomRow?.name === PACKAGE_NAME, String(headroomRow?.name))
check('headroom row is enabled', headroomRow?.disabled === undefined || headroomRow?.disabled === false)
check('headroom row carries config', typeof headroomRow?.config === 'object' && headroomRow.config !== null)
check('ttlMinutes is a number', typeof headroomRow?.config?.ttlMinutes === 'number')

// ── the package name resolves from the host row's base ─────────────────────

console.log('\nresolution')
// A host row's bare name is resolved by the ESM resolver from the profile
// directory. `require.resolve(name, { paths })` answers a DIFFERENT question
// (it treats `paths` as starting points for the CJS algorithm and misses the
// parent walk), so the check that matters is the ESM one: a module living in
// the profile directory must be able to import the bare name.
//
// That was confirmed empirically against this deployment; here it is verified
// structurally, which is what survives in a test.
const resolved = join(PACKAGE_ROOT, 'plugin', 'index.js')
check('package entry exists where the walk finds it', existsSync(resolved), resolved)

// The location matters: a copy inside <profile>/node_modules is NOT reachable
// by the upward walk, which starts at the profile directory's parent.
check(
  'installed under <profiles>/node_modules, the location the walk reaches',
  existsSync(PACKAGE_ROOT),
  PACKAGE_ROOT,
)
check(
  'no misleading copy under <profile>/node_modules',
  !existsSync(join(PROFILE_ROOT, 'node_modules', PACKAGE_NAME)),
)
check('package manifest points at a real file', existsSync(join(PACKAGE_ROOT, 'plugin', 'index.js')))
const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
check('manifest main matches the shipped layout', manifest.main === './plugin/index.js', String(manifest.main))
check('manifest exports wire the root entry', manifest.exports?.['.']?.default === './plugin/index.js')
check('manifest declares ESM', manifest.type === 'module')
// Nothing extra may sit at the package root expecting to be the entry point:
// the earlier layout shipped `index.js` there with a manifest naming it.
check('no stray index.js at the package root', !existsSync(join(PACKAGE_ROOT, 'index.js')))

// ── the resolved module registers a valid tool ─────────────────────────────

console.log('\nloaded module')
const loaded = await import('file:///' + resolved.replace(/\\/g, '/'))
check('module exports apply', typeof loaded.apply === 'function')

let registered = null
const ctx = {
  get: (name) => (name === 'tools' ? { register: (definition) => { registered = definition; return () => {} } } : undefined),
  logger: {},
}
let threw = null
try {
  loaded.apply(ctx, headroomRow?.config ?? {})
} catch (error) {
  threw = error
}
check('apply runs without throwing', threw === null, threw === null ? '' : String(threw))
check('registers the headroom tool', registered?.name === 'headroom', String(registered?.name))
check('declares output with a schema and render', registered?.output?.schema !== undefined && typeof registered?.output?.render === 'function')
let schemaProblem = null
try {
  tools.assertSupportedJsonSchema(registered.output.schema)
} catch (error) {
  schemaProblem = error
}
check('output schema is in the enforced subset', schemaProblem === null, schemaProblem === null ? '' : String(schemaProblem?.message))

const fixture = JSON.stringify({
  rows: Array.from({ length: 40 }, (_, index) => ({
    id: 'row_' + index,
    detail: 'a fairly long detail string for row number ' + index + ' that keeps going past the useful part',
  })),
})
const compressed = await registered.execute({ action: 'compress', content: fixture })
check('compresses', compressed.savedTokens > 0, String(compressed.savedTokens))
check('canonical value satisfies the declared schema', tools.validateJsonSchemaValue(registered.output.schema, compressed, 'r').length === 0)
const restored = await registered.execute({ action: 'retrieve', token: compressed.token })
check('round trip is byte-exact', restored.original === fixture)
check('render yields model-visible text', registered.output.render({ action: 'compress' }, compressed)[0].text.includes(compressed.token))

// ── no competing registration ──────────────────────────────────────────────

console.log('\nsingle registration')
// An earlier version also shipped an agent preset, but a preset registers the
// tool in its own scope while the host row registers it globally, and
// `tools.register()` rejects a duplicate name. The retired preset must be gone
// or selecting it would fail.
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

check(
  'the retired agent preset is gone',
  layout.presetsRoot === null || !existsSync(join(layout.presetsRoot, 'headroom')),
)
check('the workspace ships no agent.cordis.yml', !existsSync(join(REPO_ROOT, 'agent.cordis.yml')))

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)

/**
 * Validate the tool definition against the harness's own contract.
 *
 * This is the check that was missing the first time: the registry rejects a
 * tool without `output { schema, render }`, and it validates every canonical
 * value against that schema. Both are reproduced here with the real exported
 * functions from `@deepseek-ai/dsh-tools`, so a shape that would fail at mount
 * or at call time fails here instead.
 *
 * The package is located through `dsh-paths.mjs` rather than a literal path, so
 * the suite runs against whatever deployment it is invoked in.
 *
 * Run with: node test/tool-contract.test.mjs [--dsh-home <path>]
 */

import { createRequire } from 'node:module'
import { requireExistingPath } from '../dsh-paths.mjs'

const require = createRequire(import.meta.url)
const toolsEntry = requireExistingPath('toolsEntry')
const tools = require(toolsEntry)

const plugin = await import('../index.js')

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

// ── the registry's own gate ─────────────────────────────────────────────────

console.log('\nregistration contract')
check('plugin exports apply', typeof plugin.apply === 'function')
check('plugin exports OUTPUT_SCHEMA', plugin.OUTPUT_SCHEMA !== null && typeof plugin.OUTPUT_SCHEMA === 'object')
check('plugin exports render', typeof plugin.render === 'function')

// tools.register() rejects unless these three hold.
const captured = { definition: null }
const fakeTools = {
  register(definition) {
    // Exactly the checks dsh-tools' register() performs, in order.
    const output = definition.output
    if (
      output === undefined ||
      typeof output !== 'object' ||
      typeof output.render !== 'function' ||
      (output.presentationMeta !== undefined && typeof output.presentationMeta !== 'function')
    ) {
      throw new TypeError('tool "' + definition.name + '" must declare output { schema, render, presentationMeta? }')
    }
    tools.assertSupportedJsonSchema(output.schema)
    if (definition.name === 'run_code') throw new Error('reserved name')
    captured.definition = definition
    return () => {}
  },
}

const ctx = {
  get: (name) => (name === 'tools' ? fakeTools : undefined),
  logger: {},
}

// Each apply() returns the exact definition it registered, so a case can drive
// the instance that belongs to its own context and store.
const applied = []
const applyWith = (context, config) => {
  let registered = null
  const contextTools = {
    register(definition) {
      fakeTools.register(definition)
      registered = definition
      return () => {}
    },
  }
  const wrapped = {
    get: (name) => (name === 'tools' ? contextTools : context.get(name)),
    logger: context.logger,
  }
  plugin.apply(wrapped, config)
  applied.push(registered)
  return registered
}

let applyThrew = null
try {
  applyWith(ctx, {})
} catch (error) {
  applyThrew = error
}
const definition = applied[0]
check('apply registers without throwing', applyThrew === null, applyThrew === null ? '' : String(applyThrew))
check('a definition was registered', definition !== null && definition !== undefined)
check('tool name is headroom', definition.name === 'headroom', String(definition.name))
check('description is non-empty', typeof definition.description === 'string' && definition.description.length > 100)
check('parameters are an object schema', definition.parameters?.type === 'object')
check('parameters require action', Array.isArray(definition.parameters?.required) && definition.parameters.required.includes('action'))
check('execute is a function', typeof definition.execute === 'function')
check('output.schema is present', definition.output?.schema !== undefined)
check('output.render is a function', typeof definition.output?.render === 'function')
check('presentationMeta is omitted', definition.output?.presentationMeta === undefined)

// The harness's own subset assertion, called directly.
let schemaError = null
try {
  tools.assertSupportedJsonSchema(definition.output?.schema)
} catch (error) {
  schemaError = error
}
check('schema passes assertSupportedJsonSchema', schemaError === null, schemaError === null ? '' : String(schemaError?.message))

// ── parameter schema is honoured ────────────────────────────────────────────

console.log('\nparameter schema')
console.log('        ' + JSON.stringify(definition.parameters?.properties?.action))
check(
  'action enum matches the implemented branches',
  JSON.stringify(definition.parameters?.properties?.action?.enum) === JSON.stringify(['compress', 'retrieve', 'stats', 'forget']),
)
for (const field of ['content', 'path', 'kind', 'ratio', 'token', 'query', 'limit']) {
  check('declares `' + field + '`', definition.parameters?.properties?.[field] !== undefined)
}
check(
  'ratio enum is the implemented set',
  JSON.stringify(definition.parameters?.properties?.ratio?.enum) === JSON.stringify(['light', 'balanced', 'aggressive']),
)
check(
  'kind enum admits every implemented handler',
  JSON.stringify(definition.parameters?.properties?.kind?.enum) ===
    JSON.stringify(['auto', 'json', 'code', 'log', 'text', 'diff', 'lines']),
)

// ── every action result satisfies the declared schema ──────────────────────

console.log('\ncanonical values')

const validate = (value) => tools.validateJsonSchemaValue(definition.output.schema, value, 'result')

/** Run one call and assert its canonical value passes the declared schema. */
async function call(label, args, expectation, instance = definition) {
  const value = await instance.execute(args)
  const violations = validate(value)
  check(label + ': satisfies schema', violations.length === 0, violations.join('; '))
  if (expectation !== undefined) {
    const ok = expectation(value)
    check(label + ': behaves as expected', ok, JSON.stringify(value).slice(0, 300))
  }
  const blocks = definition.output.render(args, value)
  check(label + ': renders content blocks', Array.isArray(blocks) && blocks.length > 0 && blocks.every((b) => b.type === 'text' && typeof b.text === 'string'))
  return { value, blocks }
}

const jsonFixture = JSON.stringify({
  users: Array.from({ length: 30 }, (_, index) => ({
    id: 'usr_' + String(index).padStart(6, '0'),
    name: 'User ' + index,
    bio: 'A long biographical description for user number ' + index + ' that keeps going and going well past the useful part.',
  })),
  total: 30,
})

const compressed = await call('compress', { action: 'compress', content: jsonFixture }, (value) => value.token?.length === 16 && value.savedTokens > 0)
const stats = await call('stats', { action: 'stats' })
await call('retrieve', { action: 'retrieve', token: compressed.value.token }, (value) => value.original === jsonFixture)
await call('retrieve+query', { action: 'retrieve', token: compressed.value.token, query: 'number 7' }, (value) => Array.isArray(value.results))
await call('retrieve miss', { action: 'retrieve', token: 'ffffffffffffffff' }, (value) => value.action === 'error')
await call('retrieve no token', { action: 'retrieve' }, (value) => value.action === 'error')
await call('unknown action', { action: 'nonsense' }, (value) => value.action === 'error')
await call('compress no input', { action: 'compress' }, (value) => value.action === 'error')
await call(
  'compress forced kind',
  { action: 'compress', content: jsonFixture, kind: 'text', ratio: 'aggressive' },
  (value) => typeof value.kind === 'string',
)

// ── the fs branch ───────────────────────────────────────────────────────────
//
// Runs in its own engine so it does not consume the store the cases above rely
// on; the config key is what selects an engine.
//
// The fake target is shaped like the real `FsTarget` the DSH fs service returns
// (`{ targetKey, displayPath }`), not like a path string. An earlier version of
// this fake returned `{ path }`, which is not what any backend produces — and
// because the plugin used to feed whatever it got straight to `readText`, the
// unrealistic fake passed silently. It now only asserts what the contract
// guarantees, but the shape is still worth matching.

const fsTarget = { targetKey: 'test-key', displayPath: 'D:\\some\\file.json' }
const fsCtx = {
  get: (name) =>
    name === 'fs'
      ? {
          resolve: async () => fsTarget,
          readText: async () => jsonFixture,
          stat: async () => ({ type: 'file', size: jsonFixture.length }),
        }
      : undefined,
  logger: {},
}
const fsDefinition = applyWith(fsCtx, { storeMax: 64 })
await call('compress by path', { action: 'compress', path: 'D:\\some\\file.json' }, (value) => value.savedTokens > 0, fsDefinition)

// A resolve that yields nothing must be named as such, not blamed on the file.
const noResolveTargetCtx = {
  get: (name) => (name === 'fs' ? { resolve: async () => undefined, readText: async () => '' } : undefined),
  logger: {},
}
await call(
  'compress path that resolve cannot produce',
  { action: 'compress', path: 'D:\\nope.json' },
  (value) => value.action === 'error' && String(value.error).includes('not a readable target'),
  applyWith(noResolveTargetCtx, { storeMax: 66 }),
)

// A directory is a routine mistake and deserves to be named as one.
const directoryCtx = {
  get: (name) =>
    name === 'fs'
      ? { resolve: async () => fsTarget, readText: async () => '', stat: async () => ({ type: 'directory' }) }
      : undefined,
  logger: {},
}
await call(
  'compress a directory is refused by name',
  { action: 'compress', path: 'D:\\some\\dir' },
  (value) => value.action === 'error' && String(value.error).includes('is a directory'),
  applyWith(directoryCtx, { storeMax: 67 }),
)

// An fs service missing `resolve` must say so rather than report a read failure.
const partialFsCtx = {
  get: (name) => (name === 'fs' ? { readText: async () => '' } : undefined),
  logger: {},
}
await call(
  'compress with a partial fs service names the missing method',
  { action: 'compress', path: 'D:\\some\\file.json' },
  (value) => value.action === 'error' && String(value.error).includes('no `resolve` method'),
  applyWith(partialFsCtx, { storeMax: 68 }),
)

const brokenFsCtx = {
  get: (name) =>
    name === 'fs'
      ? { resolve: async () => { throw new Error('missing') }, readText: async () => '' }
      : undefined,
  logger: {},
}
const brokenDefinition = applyWith(brokenFsCtx, { storeMax: 65 })
await call(
  'compress unreadable path',
  { action: 'compress', path: 'D:\\nope.json' },
  (value) => value.action === 'error' && String(value.error).includes('could not read'),
  brokenDefinition,
)

// ── refusal, in a store that is actually empty ─────────────────────────────

const refusalDefinition = applyWith(ctx, { storeMax: 66 })
await call(
  'compress refused',
  { action: 'compress', content: 'tiny' },
  (value) => value.token === undefined && value.savedTokens === 0,
  refusalDefinition,
)

// ── forget, in its own store so the main token survives ────────────────────

const forgetDefinition = applyWith(ctx, { storeMax: 67 })
const tempCompressed = await forgetDefinition.execute({ action: 'compress', content: jsonFixture })
await call('forget one', { action: 'forget', token: tempCompressed.token }, (value) => value.dropped === 1, forgetDefinition)
await call('forget all', { action: 'forget' }, (value) => typeof value.dropped === 'number', forgetDefinition)
await call('retrieve after forget', { action: 'retrieve', token: tempCompressed.token }, (value) => value.action === 'error', forgetDefinition)

// An ambiguous prefix must delete nothing. The engine reports the ambiguity, and
// the tool's `forget` counts `dropped` from that answer — so if the tool ever
// treated "ambiguous" as "found", a caller could delete content they did not
// name. Two entries are built deliberately until their tokens share a first
// character, because leaving that to chance means the check silently stops
// testing anything on an unlucky run.
// `forget` must remove exactly the entry named, and nothing else.
//
// An ambiguous prefix is refused by the engine and covered there directly. The
// tool-level property worth pinning is narrower and deterministic: naming one
// token leaves every other entry alone.
//
// The payload is built here rather than reusing `jsonFixture`. That fixture's
// values are short enough that even tripled, no handler can shrink it — the
// records repeat but each field is already smaller than its marker, so the
// engine correctly refuses. The check then fails for want of a compressible
// payload rather than for anything to do with `forget`. Long values are what
// make a record worth factoring.
const targeted = applyWith(ctx, { storeMax: 502 })
const buildForgetPayload = (marker) => JSON.stringify({
  marker,
  rows: Array.from({ length: 40 }, (_, index) => ({
    id: 'row_' + marker + '_' + index,
    description: 'Row ' + index + ' of the forget fixture, carrying enough prose that the value outweighs the key that names it. '.repeat(2),
    note: 'padding '.repeat(8),
  })),
}, null, 2)
const firstEntry = await targeted.execute({ action: 'compress', content: buildForgetPayload('first') })
const secondEntry = await targeted.execute({ action: 'compress', content: buildForgetPayload('second') })
check('two distinct entries were stored', firstEntry.token !== secondEntry.token && secondEntry.token !== undefined,
  firstEntry.token + ' vs ' + secondEntry.token)

const removed = await targeted.execute({ action: 'forget', token: firstEntry.token })
const remaining = await targeted.execute({ action: 'stats' })
check('forget removes exactly the named entry', removed.dropped === 1 && remaining.storedEntries === 1,
  JSON.stringify({ dropped: removed.dropped, entries: remaining.storedEntries }))
check('the entry that was not named survives',
  (await targeted.execute({ action: 'retrieve', token: secondEntry.token })).original !== undefined)
check('the named entry is gone',
  (await targeted.execute({ action: 'retrieve', token: firstEntry.token })).action === 'error')

// ── store identity across re-apply ─────────────────────────────────────────

console.log('\nstore identity')
const reloadA = applyWith(ctx, { storeMax: 68 })
const first = await reloadA.execute({ action: 'compress', content: jsonFixture })
// A live-reloaded patch layer re-applies the plugin with the same config.
const reloadB = applyWith(ctx, { storeMax: 68 })
const second = await reloadB.execute({ action: 'retrieve', token: first.token })
check('a re-apply keeps earlier tokens resolvable', second.action === 'retrieve' && second.original === jsonFixture, JSON.stringify(second).slice(0, 200))
// A genuinely different config is allowed its own store.
const reloadC = applyWith(ctx, { storeMax: 69 })
const isolated = await reloadC.execute({ action: 'retrieve', token: first.token })
check('a different config gets its own store', isolated.action === 'error', JSON.stringify(isolated).slice(0, 200))

// ── the query/limit semantics, which three real bugs lived in ──────────────
//
// All three came from a fuzz run rather than from review, so they are pinned
// here with the exact shapes that failed:
//
//   an absent query vs a blank one, which used to collapse into "dump the
//   whole original"; `limit: 0`, which used to coerce to the default 20; and
//   the literal/related distinction, which used to be invisible.

console.log('\nquery and limit semantics')
const retireveDefinition = applyWith(ctx, { storeMax: 70 })
const queryFixture = Array.from({ length: 80 }, (_, index) =>
  index % 3 === 0
    ? '2026-03-14T09:00:00.000Z ERROR build failed: connection reset by peer'
    : '2026-03-14T09:00:00.000Z DEBUG heartbeat seq=' + index,
).join('\n')
const storedForQuery = await retireveDefinition.execute({ action: 'compress', content: queryFixture })

const noQuery = await retireveDefinition.execute({ action: 'retrieve', token: storedForQuery.token })
check('an absent query returns the whole original', noQuery.original === queryFixture, JSON.stringify(noQuery).slice(0, 120))
check('an absent query reports no region count', noQuery.matched === undefined)

for (const blank of ['', ' ', '   ', '\n']) {
  const value = await retireveDefinition.execute({ action: 'retrieve', token: storedForQuery.token, query: blank })
  check(
    'a blank query (' + JSON.stringify(blank) + ') returns no regions, not the original',
    value.original === undefined && Array.isArray(value.results) && value.results.length === 0 && value.matched === 0,
    JSON.stringify(value).slice(0, 160),
  )
}

const literalQuery = await retireveDefinition.execute({ action: 'retrieve', token: storedForQuery.token, query: 'connection reset' })
check('a literal query finds the regions that contain it', literalQuery.matched > 0 && literalQuery.literalMatches === literalQuery.matched,
  'matched=' + literalQuery.matched + ' literal=' + literalQuery.literalMatches)

// A token-overlap hit is allowed; it must simply not be counted as literal.
const relatedOnly = await retireveDefinition.execute({ action: 'retrieve', token: storedForQuery.token, query: 'heartbeat seq' })
check('literalMatches never exceeds matched', relatedOnly.literalMatches <= relatedOnly.matched,
  'matched=' + relatedOnly.matched + ' literal=' + relatedOnly.literalMatches)
check('a query matching nothing returns nothing', (await retireveDefinition.execute({ action: 'retrieve', token: storedForQuery.token, query: 'zzz-absent-zzz' })).matched === 0)

const zero = await retireveDefinition.execute({ action: 'retrieve', token: storedForQuery.token, query: 'e', limit: 0 })
check('limit 0 returns no regions', Array.isArray(zero.results) && zero.results.length === 0, JSON.stringify(zero).slice(0, 120))
const two = await retireveDefinition.execute({ action: 'retrieve', token: storedForQuery.token, query: 'e', limit: 2 })
check('limit 2 returns at most two regions', two.results.length <= 2, String(two.results.length))
const capped = await retireveDefinition.execute({ action: 'retrieve', token: storedForQuery.token, query: 'e', limit: 100000 })
check('an absurd limit is capped rather than obeyed', capped.results.length <= 200, String(capped.results.length))

// ── the mode choice, which is only partly manual ───────────────────────────
//
// Which mode runs is decided by which argument arrives — `path` or `content` —
// and there is no sniffing of the text to guess. What IS automatic is the guard:
// a `content` payload past the store limit is refused, because it arrived with a
// copy already in context, so storing it would duplicate rather than replace.
// These assertions pin both halves, since the failure mode is silent: a wrong
// answer here corrupts nothing, it just quietly costs double.

console.log('\nmode selection')
const modeDefinition = applyWith(ctx, { storeMax: 71 })
const bigFixture = JSON.stringify({
  rows: Array.from({ length: 400 }, (_, index) => ({ id: 'row_' + index, body: 'padding '.repeat(8), n: index })),
}, null, 2)
const smallFixture = JSON.stringify({
  rows: Array.from({ length: 6 }, (_, index) => ({ id: 'row_' + index, body: 'padding '.repeat(4) })),
}, null, 2)
const middleFixture = JSON.stringify({
  rows: Array.from({ length: 60 }, (_, index) => ({ id: 'row_' + index, body: 'padding '.repeat(6), n: index })),
}, null, 2)

check('the large fixture is past the store limit', bigFixture.length > 20000, bigFixture.length + ' chars')
check('the small fixture is under the advisory floor', smallFixture.length < 2000, smallFixture.length + ' chars')
check('the middling fixture sits in the advisory band',
  middleFixture.length >= 2000 && middleFixture.length <= 20000, middleFixture.length + ' chars')

const refused = await modeDefinition.execute({ action: 'compress', content: bigFixture })
check('a large `content` payload is refused', refused.action === 'error', JSON.stringify(refused).slice(0, 160))
check(
  'the refusal names the limit and the fix',
  /20,000-char limit/.test(String(refused.error)) && /`path`/.test(String(refused.error)),
  String(refused.error).slice(0, 200),
)

const smallOk = await modeDefinition.execute({ action: 'compress', content: smallFixture })
check('a small `content` payload is still accepted', smallOk.action === 'compress' && smallOk.token !== undefined,
  JSON.stringify(smallOk).slice(0, 160))
check('a small payload carries no `path` lecture', !/passing `path` instead/.test(String(smallOk.note)),
  String(smallOk.note).slice(0, 200))

// The same bytes through a named path must be accepted at any size: the mode was
// what was wrong, not the payload. This needs its own context, because the
// definition above has no `fs` service and would fail for that reason instead.
const modeFsTarget = { targetKey: 'mode-key', displayPath: 'D:\\big.json' }
const modeFsCtx = {
  get: (name) =>
    name === 'fs'
      ? {
          resolve: async () => modeFsTarget,
          readText: async () => bigFixture,
          stat: async () => ({ type: 'file', size: bigFixture.length }),
        }
      : ctx.get(name),
  logger: {},
}
const bigViaPath = await applyWith(modeFsCtx, { storeMax: 72 }).execute({ action: 'compress', path: 'D:\\big.json' })
check('the same large payload is accepted through `path`',
  bigViaPath.action === 'compress' && bigViaPath.token !== undefined, JSON.stringify(bigViaPath).slice(0, 160))

const middle = await modeDefinition.execute({ action: 'compress', content: middleFixture })
check('a middling `content` payload is accepted', middle.action === 'compress', JSON.stringify(middle).slice(0, 160))
check('a middling payload is advised to use `path`', /passing `path` instead/.test(String(middle.note)),
  String(middle.note).slice(-160))

// ── rendered text is usable ────────────────────────────────────────────────

console.log('\nrendered text')
const compressText = definition.output.render({ action: 'compress' }, compressed.value)[0].text
check('compressed payload appears verbatim', compressText.includes(jsonFixture.slice(0, 80)) === false || compressText.includes('<<hr:'))
check('rendered compress carries the token', compressText.includes(compressed.value.token))
check('rendered compress is bounded by markers', compressText.includes('<<<HEADROOM:BEGIN') && compressText.includes('<<<HEADROOM:END>>>'))
check('rendered compress states how to retrieve', compressText.includes('retrieve'))
const statsText = definition.output.render({ action: 'stats' }, stats.value)[0].text
check('rendered stats is labelled process-wide', statsText.includes('this harness process'))
const errorText = definition.output.render({ action: 'retrieve' }, { action: 'error', error: 'boom' })[0].text
check('rendered error carries the message', errorText.includes('boom'))

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)

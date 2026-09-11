/**
 * What does a compression actually add to the MODEL'S context?
 *
 * The first attempt at this measured `arg + marker` and concluded the framing was
 * 156% of the saving, which is nonsense: a tool's *arguments* are written by the
 * model, not read by it. What enters the context window is the tool RESULT, plus
 * whatever the model read in order to produce the call.
 *
 * That distinction turns out to be the whole story:
 *
 *   path mode      compress(file) -> the file never enters context, only the
 *                  compressed text does. This is the mode the tool recommends.
 *   read-then-send read(file) + compress(content) -> the original goes into
 *                  context once as the read result, and the compressed copy goes
 *                  in again as the compress result. The payload is paid for
 *                  twice, and the second copy is smaller — so the model ends up
 *                  carrying MORE than if it had simply read the file and not
 *                  compressed at all.
 *
 * The second mode is the trap, and it is the one a model falls into naturally
 * when it has already read a file and then decides to compress it.
 *
 * Run with: node bench/probe-context-cost.mjs
 */

import { asUrl, requireExistingPath } from '../dsh-paths.mjs'

const meter = await import(asUrl(requireExistingPath('meterEntry')))
const blocks = (text) => meter.estimateContent([{ type: 'text', text }])

const installed = requireExistingPath('installedEntry')
const plugin = await import(asUrl(installed))

let tool = null
const files = new Map()
plugin.apply(
  {
    get: (name) => {
      if (name === 'tools') return { register: (definition) => { tool = definition; return () => {} } }
      // A minimal stand-in for the harness `fs` service, so `path` mode can run
      // outside a live session. `readText` receives the FsTarget that `resolve`
      // returned, NOT the original path string — a shim that expects a string
      // here returns undefined and the measurement silently becomes "path mode
      // is broken", which is a mistake this file made once already.
      if (name === 'fs') {
        return {
          resolve: async (path) => (files.has(String(path)) ? { targetKey: 'k:' + path, displayPath: String(path) } : undefined),
          readText: async (target) => files.get(String(target?.displayPath)),
          stat: async (target) => (files.has(String(target?.displayPath)) ? { type: 'file', size: files.get(String(target.displayPath)).length } : undefined),
        }
      }
      return undefined
    },
    logger: { warn() {}, info() {}, debug() {} },
  },
  // The content-store guard is deliberately disabled here. This probe measures
  // the cost of mode B — read the file, then pass it as `content` — precisely so
  // the comparison can be quantified. With the default limit in force, mode B
  // would be refused before the engine ran and the probe would have nothing to
  // compare. The guard exists to stop that pattern at runtime; measuring it is a
  // different job, and the shipped defaults are reported separately below.
  { contentStoreLimitChars: Number.MAX_SAFE_INTEGER, contentHintMinChars: Number.MAX_SAFE_INTEGER },
)

// ── the fixed cost every request carries, whether or not it compresses ──────

const fixed = blocks(tool.description) + blocks(JSON.stringify(tool.parameters)) + blocks(JSON.stringify(tool.output.schema))
console.log('fixed cost of the tool definition')
console.log('  description      ' + String(blocks(tool.description)).padStart(6) + ' tokens')
console.log('  parameters       ' + String(blocks(JSON.stringify(tool.parameters))).padStart(6) + ' tokens')
console.log('  output schema    ' + String(blocks(JSON.stringify(tool.output.schema))).padStart(6) + ' tokens')
console.log('  TOTAL            ' + String(fixed).padStart(6) + ' tokens, on every request')
console.log('')
console.log('  This is why the description is kept short and no batch `items` array was added:')
console.log('  schema tokens are paid on every request, while a saved call is paid once.')
console.log('')

const ROWS = []
for (const [label, count] of [['4 KB', 20], ['40 KB', 200], ['400 KB', 2000]]) {
  const content = JSON.stringify({ data: Array.from({ length: count }, (_, i) => ({ id: 'u' + i, bio: 'b'.repeat(120) })) }, null, 2)
  const path = 'D:/tmp/' + label.replace(' ', '') + '.json'
  files.set(path, content)

  const original = blocks(content)

  // Mode A: path mode. The model never sees the original.
  const viaPath = await tool.execute({ action: 'compress', path })
  const pathResult = blocks(tool.output.render({ action: 'compress' }, viaPath)[0].text)

  // Mode B: the trap. The file was read first, so the original is already in
  // context; the compress result then adds a second, compressed copy.
  const readResult = original
  const viaContent = await tool.execute({ action: 'compress', content })
  const contentResult = blocks(tool.output.render({ action: 'compress' }, viaContent)[0].text)

  ROWS.push({ label, original, pathResult, contentResult, readResult })
  console.log('payload ' + label.padEnd(8) + ' original ' + String(original).padStart(7) + ' tokens')
  console.log('  A path mode        context after: ' + String(pathResult).padStart(7) +
    '   = ' + (100 * (original - pathResult) / original).toFixed(1) + '% smaller than the raw file')
  console.log('  B read then send   context after: ' + String(readResult + contentResult).padStart(7) +
    '   = ' + (100 * (readResult + contentResult - original) / original).toFixed(1) + '% LARGER than just reading it')
  console.log('  penalty for B over A: ' + (readResult + contentResult - pathResult).toLocaleString('en-US') + ' extra tokens')
  console.log('')
}

console.log('summary')
const worst = ROWS[ROWS.length - 1]
console.log('  path mode is always the smaller outcome, and the gap grows with the payload:')
for (const row of ROWS) {
  console.log('    ' + row.label.padEnd(8) + 'A=' + String(row.pathResult).padStart(7) +
    '  B=' + String(row.readResult + row.contentResult).padStart(7) +
    '  B costs ' + ((row.readResult + row.contentResult) / row.pathResult).toFixed(2) + 'x what A does')
}
console.log('')
console.log('  On the ' + worst.label + ' payload that is a ' +
  ((worst.readResult + worst.contentResult) / worst.pathResult).toFixed(1) +
  'x difference — far larger than any saving a batch action or a smaller schema could produce.')
console.log('  The lever that matters is which mode is used, not how many calls are made.')

// ── a partial fs service must be diagnosed, not blamed on the file ──────────

console.log('')
console.log('what the shipped guard does about it')
console.log('  The numbers above measure both modes with the content guard disabled.')
console.log('  In the shipped configuration, mode B is not merely expensive — a `content`')
console.log('  payload past ' + '20,000' + ' chars is refused outright, so the 400 KB case cannot')
console.log('  happen at all. The guard is the enforcement; this table is the reason.')
console.log('')
console.log('path mode when the fs service is incomplete')

async function withFs(impl) {
  let scoped = null
  const fresh = await import(asUrl(installed) + '?v=' + Math.random())
  fresh.apply(
    {
      get: (name) => {
        if (name === 'tools') return { register: (definition) => { scoped = definition; return () => {} } }
        if (name === 'fs') return impl
        return undefined
      },
      logger: { warn() {}, info() {}, debug() {} },
    },
    {},
  )
  return scoped
}

// Each shim returns a well-formed FsTarget, so the case under test is the one
// that actually runs: a string or a undefined here would be stopped by the
// resolve guard and every row would report the same thing.
const target = { targetKey: 'k', displayPath: 'x.json' }

for (const [label, impl] of [
  ['no fs service', undefined],
  ['fs without resolve', { readText: async () => 'x' }],
  ['fs without readText', { resolve: async () => target }],
  ['resolve returns undefined', { resolve: async () => undefined, readText: async () => 'x' }],
  ['resolve returns a string', { resolve: async () => 'x.json', readText: async () => 'x' }],
  ['readText returns undefined', { resolve: async () => target, readText: async () => undefined }],
  ['readText throws EACCES', { resolve: async () => target, readText: async () => { throw new Error('EACCES') } }],
]) {
  const scoped = await withFs(impl)
  const outcome = await scoped.execute({ action: 'compress', path: 'x.json' })
  const message = String(outcome.error ?? '(no error)')
  // "could not read x.json: EACCES" is CORRECT when the read genuinely failed:
  // the cause is named. The failure worth flagging is blaming the file for a
  // problem that is not the file's — a missing method, or a resolve that
  // produced nothing.
  const blamesFile = /could not read x\.json/.test(message)
  const namesCause = /EACCES|ENOENT|permission|denied/i.test(message)
  const verdict = blamesFile && !namesCause ? 'VAGUE' : 'ok   '
  console.log('  ' + verdict + '  ' + label.padEnd(26) + message.slice(0, 72))
}

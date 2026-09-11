/**
 * How much would the INSTALLED headroom have saved on this conversation?
 *
 * The plugin records per-process counters, and this conversation started before
 * the row existed, so its `stats` action has nothing to report for it. What can
 * be measured is the payload itself: the exact bytes this session pulled into
 * context, run through the installed tool, priced with the harness's own
 * estimator.
 *
 * Sources, in order of how much of the transcript they account for:
 *
 *   - spill files: large tool results the harness truncated to disk, so these
 *     are byte-for-byte what the tool returned.
 *   - payloads reconstructed from material read verbatim during the session and
 *     written to corpus/ by build-corpus.mjs.
 *
 * Run with: node bench/session-savings.mjs
 */

import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'node:fs'
import { asUrl, requireExistingPath } from '../dsh-paths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

const meter = await import(asUrl(requireExistingPath('meterEntry')))
const meterTokens = (text) => meter.estimateContent([{ type: 'text', text }])

const ENTRY = requireExistingPath('installedEntry')

const plugin = await import(asUrl(ENTRY))
let tool = null
plugin.apply(
  { get: (name) => (name === 'tools' ? { register: (d) => { tool = d; return () => {} } } : undefined), logger: {} },
  // The corpus payloads are all past the content-store limit, so a `content`
  // call would be refused before the engine ran. This script measures corpus
  // files it reads from disk, which is exactly the case `path` exists for, so it
  // raises the limit rather than pretending the guard is absent.
  { ttlMinutes: 60, storeMax: 256, contentStoreLimitChars: Number.MAX_SAFE_INTEGER },
)
if (tool === null) {
  console.error('the installed module registered no tool')
  process.exit(1)
}

// ── gather the payloads ─────────────────────────────────────────────────────

const payloads = []

// 1. Spill files: large tool results the harness wrote to disk instead of into
//    context. Their location is machine-specific and user-specific, so it is
//    taken from the environment or a flag rather than hardcoded — an absolute
//    path under someone's home directory has no business in a published file.
//      node bench/session-savings.mjs --spill <dir>
//      HEADROOM_SPILL_DIR=<dir> node bench/session-savings.mjs
const spillRoots = []
const spillFlag = process.argv.indexOf('--spill')
if (spillFlag !== -1 && process.argv[spillFlag + 1] !== undefined) {
  spillRoots.push(process.argv[spillFlag + 1])
} else if (typeof process.env.HEADROOM_SPILL_DIR === 'string' && process.env.HEADROOM_SPILL_DIR.trim() !== '') {
  spillRoots.push(process.env.HEADROOM_SPILL_DIR.trim())
}

for (const root of spillRoots) {
  if (!existsSync(root)) {
    console.log('  (spill directory not found, skipping: ' + root + ')')
    continue
  }
  for (const name of readdirSafe(root)) {
    const path = join(root, name)
    payloads.push({ label: 'spill:' + name.replace(/^[0-9a-f]+-/, '').replace('.txt', ''), path })
  }
}

// 2. Corpus payloads: the shapes that dominated the session. Regenerate with
//    `node corpus/build-corpus.mjs` if this directory is empty.
const CORPUS = join(HERE, '..', 'corpus')
if (existsSync(CORPUS)) {
  for (const name of readdirSafe(CORPUS)) {
    if (name === 'build-corpus.mjs') continue
    payloads.push({ label: 'corpus:' + name, path: join(CORPUS, name) })
  }
}

function readdirSafe(dir) {
  try {
    return globSync('*', { cwd: dir }).sort()
  } catch {
    return []
  }
}

// ── measure ─────────────────────────────────────────────────────────────────

let totalBefore = 0
let totalAfter = 0
let totalChars = 0
let totalSavedChars = 0
let roundTripFailures = 0

console.log('  payload                            kind   meter tokens        saved    chars')
console.log('  ' + '-'.repeat(96))

for (const { label, path } of payloads) {
  const content = readFileSync(path, 'utf8')
  const result = await tool.execute({ action: 'compress', content })
  if (result.token === undefined) {
    console.log('  ' + label.padEnd(34) + 'REFUSED: ' + String(result.note))
    continue
  }
  const back = await tool.execute({ action: 'retrieve', token: result.token })
  if (back.original !== content) roundTripFailures += 1

  const before = meterTokens(content)
  const after = meterTokens(result.compressed)
  totalBefore += before
  totalAfter += after
  totalChars += content.length
  totalSavedChars += content.length - result.compressed.length

  console.log(
    '  ' + label.padEnd(34) +
      String(result.kind).padEnd(7) +
      (before + ' -> ' + after).padEnd(19) +
      (((100 * (before - after)) / before).toFixed(1) + '%').padEnd(8) +
      statSync(path).size.toLocaleString('en-US'),
  )
}

console.log('  ' + '-'.repeat(96))
console.log(
  '  ' + 'TOTAL'.padEnd(41) + (totalBefore + ' -> ' + totalAfter).padEnd(19) +
    ((100 * (totalBefore - totalAfter)) / totalBefore).toFixed(1) + '%',
)

console.log('\n  payload size            : ' + totalChars.toLocaleString('en-US') + ' chars -> ' + (totalChars - totalSavedChars).toLocaleString('en-US'))
console.log('  meter tokens kept out   : ' + (totalBefore - totalAfter).toLocaleString('en-US') + ' of ' + totalBefore.toLocaleString('en-US'))
console.log('  round-trip failures     : ' + roundTripFailures)

// Cost framing, stated as arithmetic on the measured numbers rather than a
// price guess: the reader can apply whatever rate their model charges.
const reduction = (totalBefore - totalAfter) / totalBefore
console.log('  reduction               : ' + (reduction * 100).toFixed(1) + '% of the input tokens')
console.log('\n  At the flash cache-miss input rate of ¥0.15/M these tokens are worth about ¥' +
  ((totalBefore * 0.15) / 1e6 * reduction).toFixed(4) + ' per full pass over this corpus,')
console.log('  and the same tokens at ¥0.30/M off-peak would be ¥' + ((totalBefore * 0.3) / 1e6 * reduction).toFixed(4) + '.')

process.exit(roundTripFailures === 0 ? 0 : 1)

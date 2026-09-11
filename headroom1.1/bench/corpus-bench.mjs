/**
 * Measure the engine on this session's real payloads.
 *
 * Two independent token estimators are reported, and every optimization must
 * improve BOTH or it is not an improvement:
 *
 *   - `own`   — the engine's estimator (conservative on identifier-ish ASCII).
 *   - `meter` — `@deepseek-ai/dsh-token-meter`'s `estimateContent`, which is the
 *               heuristic the harness prices model requests with.
 *
 * Run with: node bench/corpus-bench.mjs
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compress, getEngine, estimateTokens } from '../lib/engine.js'
import { asUrl, requireExistingPath } from '../dsh-paths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CORPUS = join(HERE, '..', 'corpus')

const meter = await import(asUrl(requireExistingPath('meterEntry')))
const meterTokens = (text) => meter.estimateContent([{ type: 'text', text }])

const names = readdirSync(CORPUS).filter((name) => name !== 'build-corpus.mjs').sort()

let totalOwnBefore = 0
let totalOwnAfter = 0
let totalMeterBefore = 0
let totalMeterAfter = 0
let totalCharsBefore = 0
let totalCharsAfter = 0
let failures = 0

console.log('  payload          kind   chars              own tokens         meter tokens       saved (own/meter)')
console.log('  ' + '-'.repeat(106))

for (const name of names) {
  const content = readFileSync(join(CORPUS, name), 'utf8')
  const engine = getEngine({ storeMax: 32, ttlMs: 60_000 })
  const result = compress(content, { store: engine.store })

  if (result.stored !== true) {
    console.log('  ' + name.padEnd(17) + 'REFUSED  ' + String(result.note))
    failures += 1
    continue
  }

  // Losslessness is not negotiable, so it is checked on every run.
  const back = engine.store.find(result.token)
  if (back.kind !== 'found' || back.entry.text !== content) {
    console.log('  ' + name.padEnd(17) + 'FAIL: round trip is not byte-exact')
    failures += 1
    continue
  }

  const meterBefore = meterTokens(content)
  const meterAfter = meterTokens(result.compressed)
  const ownSaved = (100 * (result.originalTokens - result.compressedTokens)) / result.originalTokens
  const meterSaved = (100 * (meterBefore - meterAfter)) / meterBefore

  totalOwnBefore += result.originalTokens
  totalOwnAfter += result.compressedTokens
  totalMeterBefore += meterBefore
  totalMeterAfter += meterAfter
  totalCharsBefore += content.length
  totalCharsAfter += result.compressed.length

  console.log(
    '  ' + name.padEnd(17) +
      String(result.kind).padEnd(7) +
      (content.length.toLocaleString('en-US') + ' -> ' + result.compressed.length.toLocaleString('en-US')).padEnd(19) +
      (result.originalTokens + ' -> ' + result.compressedTokens).padEnd(19) +
      (meterBefore + ' -> ' + meterAfter).padEnd(19) +
      ownSaved.toFixed(1) + '% / ' + meterSaved.toFixed(1) + '%',
  )
}

const ownTotal = (100 * (totalOwnBefore - totalOwnAfter)) / totalOwnBefore
const meterTotal = (100 * (totalMeterBefore - totalMeterAfter)) / totalMeterBefore

console.log('  ' + '-'.repeat(106))
console.log(
  '  ' + 'TOTAL'.padEnd(25) +
    (totalCharsBefore.toLocaleString('en-US') + ' -> ' + totalCharsAfter.toLocaleString('en-US')).padEnd(19) +
    (totalOwnBefore + ' -> ' + totalOwnAfter).padEnd(19) +
    (totalMeterBefore + ' -> ' + totalMeterAfter).padEnd(19) +
    ownTotal.toFixed(1) + '% / ' + meterTotal.toFixed(1) + '%',
)

console.log('\n  meter tokens kept out of context: ' + (totalMeterBefore - totalMeterAfter).toLocaleString('en-US'))
console.log('  own tokens kept out of context:   ' + (totalOwnBefore - totalOwnAfter).toLocaleString('en-US'))
console.log('  estimators agree within:          ' + Math.abs(ownTotal - meterTotal).toFixed(1) + ' points')
console.log('  engine estimator vs meter ratio:  ' + (estimateTokens(names.map((n) => readFileSync(join(CORPUS, n), 'utf8')).join('')) / meterTokens(names.map((n) => readFileSync(join(CORPUS, n), 'utf8')).join(''))).toFixed(2))

process.exit(failures === 0 ? 0 : 1)

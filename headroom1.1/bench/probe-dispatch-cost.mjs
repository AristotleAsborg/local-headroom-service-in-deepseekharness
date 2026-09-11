/**
 * Measure what the handler dispatch costs, and what the fast path saves.
 *
 * `compress` used to run all six handlers and keep one. When detection is right —
 * which the corpus says is most of the time — the other five were computed and
 * discarded, each a full walk of the payload. The fast path now runs only the
 * detected handler when that handler already clears the savings floor, and falls
 * back to the full scan when it does not.
 *
 * This probe measures BOTH orderings on the same payloads, through the engine's
 * own `fullScan` switch, so the saving is a measurement rather than a claim — and
 * so a future change to the fast path has a baseline to beat.
 *
 * Run with: node bench/probe-dispatch-cost.mjs
 */

import { compress, getEngine, detectKind } from '../lib/engine.js'

const engine = getEngine({ storeMax: 8, ttlMs: 60_000 })

const CASES = [
  ['log 150 KB', Array.from({ length: 900 }, (_, i) =>
    '2026-03-14T09:' + String(i % 60).padStart(2, '0') + ':00.000Z DEBUG pool.worker heartbeat seq=' + i +
    ' idle=' + (i % 4) + ' rss=' + (48000 + i * 7) + 'kb').join('\n')],
  ['json 120 KB', JSON.stringify({ data: Array.from({ length: 300 }, (_, i) => ({
    id: 'usr_01H' + String(i).padStart(6, '0'), name: 'name-' + i, active: i % 3 !== 0,
    bio: 'A long profile biography for person number ' + i + ' that no caller reads, padded out to a realistic length.',
  })) }, null, 2)],
  ['code 34 KB', ['import { x } from "y"', 'export class Big {', ...Array.from({ length: 120 }, (_, i) =>
    '  method' + i + '(input: number[]): number {\n    let total = 0\n    for (const v of input) total += v * ' + (i + 1) + '\n    return total\n  }'), '}'].join('\n')],
  ['text 113 KB', ['# Doc', ''].concat(Array.from({ length: 40 }, (_, i) =>
    '## Section ' + i + '\n\n' + 'The team considered the proposal at length during the review. '.repeat(30) + '\n')).join('\n')],
  ['diff 15 KB', ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,60 +1,60 @@'].concat(
    Array.from({ length: 60 }, (_, i) => '-const previous = state.nodes[' + i + '] ?? fallback(' + i + ')'),
    Array.from({ length: 60 }, (_, i) => '+const previous = resolveNode(state, ' + i + ', fallback)')).join('\n')],
]

/** Mean milliseconds per call for one payload, warm. */
function time(content, runs, options) {
  for (let i = 0; i < 3; i += 1) compress(content, { store: engine.store, ...options })
  const started = performance.now()
  for (let i = 0; i < runs; i += 1) compress(content, { store: engine.store, ...options })
  return (performance.now() - started) / runs
}

console.log('what one compress call costs')
console.log('  ' + 'case'.padEnd(14) + 'chars'.padStart(9) + 'detected'.padStart(10) + 'used'.padStart(8) +
  'fast ms'.padStart(9) + 'full ms'.padStart(9) + 'saved'.padStart(8))
console.log('  ' + '-'.repeat(67))

let totalFast = 0
let totalFull = 0
let totalChars = 0
for (const [label, content] of CASES) {
  const detected = detectKind(content)
  const runs = 12
  const fastMs = time(content, runs, {})
  const fullMs = time(content, runs, { fullScan: true })
  const used = compress(content, { store: engine.store }).kind
  totalFast += fastMs
  totalFull += fullMs
  totalChars += content.length
  console.log('  ' + label.padEnd(14) + String(content.length).padStart(9) + detected.padStart(10) +
    String(used).padStart(8) + fastMs.toFixed(2).padStart(9) + fullMs.toFixed(2).padStart(9) +
    (((fullMs - fastMs) / fullMs) * 100).toFixed(0).padStart(7) + '%')
}

console.log('  ' + '-'.repeat(67))
console.log('  ' + ('total ' + Math.round(totalChars / 1024) + ' KB').padEnd(14) +
  ''.padStart(9) + ''.padStart(10) + ''.padStart(8) + totalFast.toFixed(2).padStart(9) +
  totalFull.toFixed(2).padStart(9) + (((totalFull - totalFast) / totalFull) * 100).toFixed(0).padStart(7) + '%')

console.log('')
console.log('reading this')
console.log('  fast = the shipped path: the detected handler runs first and the other five')
console.log('         are skipped when it already clears the savings floor.')
console.log('  full = `fullScan: true`, the ordering the fast path replaced: every handler')
console.log('         runs and the winner is chosen from the complete set.')
console.log('')
console.log('  The two must always agree on the winner — that is what probe-dispatch-diff.mjs')
console.log('  checks. A fast path that is quicker because it decides differently would be')
console.log('  a wrong answer computed cheaply, not an optimisation.')
console.log('')
console.log('  Where `saved` is 0% the two paths did the same work: the detected handler fell')
console.log('  short of the floor, so the full scan had to run anyway to look for a fallback.')

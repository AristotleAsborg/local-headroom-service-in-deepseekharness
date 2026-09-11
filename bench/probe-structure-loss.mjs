/**
 * How much does the fallback selection cost in readability?
 *
 * The selection rule prefers the detected handler when it clears the savings
 * floor, and otherwise takes the candidate that keeps the most text. That second
 * rule measures SIZE, not INFORMATION: a handler that collapses a whole document
 * into one marker is the smallest and therefore wins, even when the detected
 * handler produced a legible outline at a smaller-but-real saving.
 *
 * Observed on a 584-character JSON array: the JSON handler kept the key schema
 * and all six records at 149 of 165 tokens (9.7%, below the 12% floor), so the
 * fallback chose `code`, which masked the entire body and reported 90.9% —
 * shipping `[\n<<hr:body:hidden=580>>\n]`, a document with no content in it.
 *
 * This measures how often that happens on the real corpus, by comparing how many
 * of the original's key/identifier tokens survive in the chosen output.
 *
 * Run with: node bench/probe-structure-loss.mjs
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { compress, getEngine, detectKind, estimateTokens } from '../lib/engine.js'
import { CONVERSATIONS, readIndex } from './lib/measure.mjs'

/**
 * A cheap structural footprint: the key and identifier tokens a reader navigates
 * by. Deliberately not the full text — retaining filler is not the goal, and a
 * handler is supposed to drop filler.
 */
function footprint(text) {
  const set = new Set()
  for (const match of text.matchAll(/"[^"\n]{1,48}"|[A-Za-z_][A-Za-z0-9_]{2,}/g)) set.add(match[0])
  return set
}

const engine = getEngine({ storeMax: 256, ttlMs: 60_000 })

const payloads = []
const index = readIndex()
for (const conversation of index.conversations) {
  for (const payload of conversation.payloads) {
    payloads.push([
      conversation.id.replace(/^conv-\d+-/, '') + '/' + payload.name,
      readFileSync(join(CONVERSATIONS, conversation.id, payload.name), 'utf8'),
    ])
  }
}

console.log('  ' + 'payload'.padEnd(34) + 'detected'.padEnd(9) + 'ran'.padEnd(7) +
  'saved'.padStart(7) + '  footprint'.padStart(12) + '  verdict')
console.log('  ' + '-'.repeat(88))

const suspicious = []
for (const [label, content] of payloads) {
  const detected = detectKind(content)
  const result = compress(content, { store: engine.store })
  if (result.stored === false) continue

  const before = footprint(content)
  const after = footprint(result.compressed)
  let kept = 0
  for (const token of before) if (after.has(token)) kept += 1
  const retention = before.size === 0 ? 1 : kept / before.size

  // A handler may legitimately drop filler, but losing most of the footprint
  // while claiming a large saving means the saving came from hiding content.
  //
  // A `text -> lines` fallback is NOT that: a directory listing or a test
  // transcript is line-oriented, detection calls it prose because it has no
  // stronger signal, and sampling whole lines is the right transform. The
  // footprint falls because sampling is the point. Only a fallback that keeps
  // the payload's own structure from being readable is a defect.
  const fellBack = result.kind !== detected
  const benign = detected === 'text' && result.kind === 'lines'
  const lost = retention < 0.6 && !benign
  if (fellBack && lost) suspicious.push({ label, detected, ran: result.kind, retention, saved: result.savedPercent })

  const verdict = !fellBack ? 'detected' : benign ? 'fell back (sampling: expected)' : lost ? 'FELL BACK, LOST STRUCTURE' : 'fell back'

  console.log('  ' + label.slice(0, 33).padEnd(34) + detected.padEnd(9) + String(result.kind).padEnd(7) +
    (result.savedPercent.toFixed(1) + '%').padStart(7) +
    (kept + '/' + before.size + ' = ' + (retention * 100).toFixed(0) + '%').padStart(16) +
    '  ' + verdict)
}

console.log('')
console.log('payloads where the fallback dropped most of the footprint: ' + suspicious.length)
for (const entry of suspicious) {
  console.log('  ' + entry.label + ': detected ' + entry.detected + ' -> ran ' + entry.ran +
    ' at ' + entry.saved.toFixed(1) + '% with ' + (entry.retention * 100).toFixed(0) + '% of the footprint')
}
if (suspicious.length === 0) {
  console.log('  none — every fallback that lost footprint was line sampling, which is the point of it')
}

// The regression this probe was written for: valid JSON handed to the `code`
// handler, which keeps the brackets and masks everything between them.
console.log('')
console.log('the shape that motivated this probe')
{
  const page = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: i, body: 'b'.repeat(60) })), null, 2)
  const result = compress(page, { store: engine.store })
  const validJson = (() => {
    try {
      JSON.parse(result.compressed.split('\n')[0])
      return true
    } catch {
      return false
    }
  })()
  console.log('  6-record JSON array: ran=' + result.kind +
    ' stored=' + (result.stored !== false) +
    ' output is valid JSON=' + (result.stored === false ? 'n/a (refused, original returned)' : validJson))
}

// The same question on the small shapes where it was first noticed.
console.log('')
console.log('small JSON documents (where the array example came from)')
for (const [label, content] of [
  ['array of 6 records', JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: i, body: 'b'.repeat(60) })), null, 2)],
  ['object with 6 records', JSON.stringify({ rows: Array.from({ length: 6 }, (_, i) => ({ id: i, body: 'b'.repeat(60) })) }, null, 2)],
  ['array of 4 numbers', JSON.stringify({ numbers: [0, 7, 14, 21] }, null, 2)],
  ['20-record page', JSON.stringify({ data: Array.from({ length: 20 }, (_, i) => ({ id: 'u' + i, bio: 'bio '.repeat(12) })) }, null, 2)],
]) {
  const result = compress(content, { store: engine.store })
  const before = footprint(content)
  const after = footprint(result.compressed)
  let kept = 0
  for (const token of before) if (after.has(token)) kept += 1
  console.log('  ' + label.padEnd(24) + 'ran=' + String(result.kind).padEnd(7) +
    'saved=' + (result.savedPercent.toFixed(1) + '%').padStart(7) +
    '  footprint ' + kept + '/' + before.size + ' (' + ((100 * kept) / before.size).toFixed(0) + '%)')
}

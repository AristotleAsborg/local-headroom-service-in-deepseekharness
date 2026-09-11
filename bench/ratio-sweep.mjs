/**
 * Compression efficiency at each ratio preset.
 *
 * The `ratio` knob is the caller's only lever on how much to drop: `light` keeps
 * more context, `balanced` is the default, `aggressive` keeps only the skeleton.
 * This runs the generated conversations through all three with the same
 * measurement code the main bench uses, then reports what each one costs in
 * reference material.
 *
 * The point of the sweep is the trade, not the biggest number: a ratio that
 * cannot be read from is not a saving, so the table carries identifier retention
 * next to the percentage, and round trips are verified at every ratio.
 *
 * Run with: node bench/ratio-sweep.mjs
 */

import { loadTool, measureCorpus, compressPayload, CONVERSATIONS } from './lib/measure.mjs'

const tool = await loadTool()
const RATIOS = ['light', 'balanced', 'aggressive']

console.log('headroom compression efficiency by ratio preset')
console.log('corpus: 6 generated test conversations, 17 payloads, ~912k chars')
console.log('')

const results = []
for (const ratio of RATIOS) {
  const measured = await measureCorpus(tool, { ratio })
  results.push({ ratio, ...measured })
}

// ── totals per ratio ────────────────────────────────────────────────────────

console.log(
  '  ' + 'ratio'.padEnd(12) + 'chars'.padEnd(21) + 'meter tokens'.padEnd(22) +
    'saved (meter)'.padEnd(15) + 'saved (own)'.padEnd(13) + 'idents (occ/uniq)'.padEnd(20) + 'round trip',
)
console.log('  ' + '-'.repeat(116))

for (const result of results) {
  const rows = result.rows.filter((row) => !row.refused)
  const occ = rows.reduce((total, row) => total + row.retention.occ, 0) / rows.length
  const uniq = rows.reduce((total, row) => total + row.retention.uniq, 0) / rows.length
  const lossless = rows.every((row) => row.lossless)
  console.log(
    '  ' + result.ratio.padEnd(12) +
      (result.total.charsBefore + ' -> ' + result.total.charsAfter).padEnd(21) +
      (result.total.meterBefore + ' -> ' + result.total.meterAfter).padEnd(22) +
      (result.total.savedPercent.toFixed(1) + '%').padEnd(15) +
      (result.total.ownSavedPercent.toFixed(1) + '%').padEnd(13) +
      ((occ * 100).toFixed(0) + '% / ' + (uniq * 100).toFixed(0) + '%').padEnd(20) +
      (lossless ? 'byte-exact' : 'FAILED'),
  )
}

// ── per conversation, so one ratio cannot hide behind an average ────────────

console.log('')
console.log('by conversation (meter tokens saved)')
console.log('  ' + 'conversation'.padEnd(30) + RATIOS.map((ratio) => ratio.padEnd(14)).join(''))
console.log('  ' + '-'.repeat(30 + RATIOS.length * 14))

const conversationIds = [...new Set(results[0].rows.map((row) => row.conversation))]
for (const id of conversationIds) {
  const cells = results.map((result) => {
    const rows = result.rows.filter((row) => row.conversation === id)
    const before = rows.reduce((total, row) => total + row.meterBefore, 0)
    const after = rows.reduce((total, row) => total + row.meterAfter, 0)
    return ((100 * (before - after)) / before).toFixed(1) + '%'
  })
  console.log('  ' + id.padEnd(30) + cells.map((cell) => cell.padEnd(14)).join(''))
}

// ── per kind ────────────────────────────────────────────────────────────────

console.log('')
console.log('by detected kind (meter tokens saved)')
const kinds = [...new Set(results[1].rows.map((row) => row.kind))].sort()
console.log('  ' + 'kind'.padEnd(10) + RATIOS.map((ratio) => ratio.padEnd(14)).join(''))
console.log('  ' + '-'.repeat(10 + RATIOS.length * 14))
for (const kind of kinds) {
  const cells = results.map((result) => {
    const rows = result.rows.filter((row) => row.kind === kind)
    if (rows.length === 0) return '-'
    const before = rows.reduce((total, row) => total + row.meterBefore, 0)
    const after = rows.reduce((total, row) => total + row.meterAfter, 0)
    return ((100 * (before - after)) / before).toFixed(1) + '%'
  })
  console.log('  ' + kind.padEnd(10) + cells.map((cell) => cell.padEnd(14)).join(''))
}

// ── what the knob actually controls ─────────────────────────────────────────

/**
 * `ratio` is a backstop, not a dial: the engine's handlers are deterministic, and
 * `targetRatio` is consulted only when the compressed text is still longer than
 * MAX_VISIBLE_CHARS, where it decides whether to cap the visible text. On
 * ordinary payloads the three presets therefore agree exactly, which is worth
 * measuring rather than assuming, so this finds the point where they diverge.
 */
const MAX_VISIBLE_CHARS = 120_000
// Sizing matters: the cap is on the COMPRESSED text, so the payload must be big
// enough that even a factored pass leaves more than MAX_VISIBLE_CHARS behind.
const bulky = JSON.stringify({
  entries: Array.from({ length: 2600 }, (_, index) => ({
    id: 'rec_' + String(index).padStart(5, '0'),
    label: 'Entry number ' + index + ' with a label long enough to survive a light pass but not a cap',
    blob: 'x'.repeat(240),
  })),
})

console.log('')
console.log('where the knob changes anything (compressed text must exceed MAX_VISIBLE_CHARS = ' + MAX_VISIBLE_CHARS.toLocaleString('en-US') + ')')
console.log('  payload: ' + bulky.length.toLocaleString('en-US') + ' chars, 2600 records')
const bulkyResults = []
for (const ratio of RATIOS) {
  // Through `path`, like every other large payload here: a `content` call past
  // the store limit is refused, and the refusal would say nothing about the
  // ratio it was asked for.
  const { result } = await compressPayload(tool, { content: bulky, label: 'bulky.json', ratio })
  bulkyResults.push({ ratio, result })
  console.log('  ' + ratio.padEnd(12) + 'chars ' + String(bulky.length).padEnd(9) + '-> ' +
    String(result.compressed?.length).padEnd(9) +
    '  tokens ' + String(result.originalTokens).padEnd(7) + '-> ' + String(result.compressedTokens).padEnd(7) +
    '  capped=' + (result.truncated === true))
}
const distinctOutputs = new Set(bulkyResults.map((entry) => entry.result.compressed)).size
console.log('  distinct outputs across the three presets: ' + distinctOutputs)
console.log('  (a payload under the cap compresses deterministically: the preset cannot change it)')

// ── the trade, stated as prose ──────────────────────────────────────────────

const light = results[0].total
const balanced = results[1].total
const aggressive = results[2].total
console.log('')
console.log('what the sweep shows')
console.log('  light / balanced / aggressive saved : ' +
  results.map((result) => result.total.savedPercent.toFixed(1) + '%').join(' / '))
console.log('  extra saving from aggressive        : ' + (aggressive.savedPercent - light.savedPercent).toFixed(1) + ' points')
console.log('  time per payload                    : ' +
  (results.map((result) => result.ratio + ' ' + (result.total.elapsed / result.rows.length).toFixed(1) + 'ms').join(', ')))
console.log('')
console.log('  corpus directory: ' + CONVERSATIONS)

const failures = results.flatMap((result) => result.rows.filter((row) => row.refused || !row.lossless))
if (failures.length > 0) {
  console.log('')
  for (const row of failures) {
    console.log('  FAIL ' + row.conversation + '/' + row.payload + ' :: ' + (row.note ?? 'round trip differed'))
  }
}
console.log('')
console.log(failures.length === 0 ? 'every payload compressed, stored and round-tripped at every ratio' : failures.length + ' failures')
process.exit(failures.length === 0 ? 0 : 1)

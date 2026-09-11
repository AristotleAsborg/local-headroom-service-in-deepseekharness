/**
 * Probe content detection: does each shape reach a handler that suits it?
 *
 * `detectKind` is the router — it decides which of the six handlers runs — and it
 * was the last major component with no dedicated probe. Its mistakes are quiet:
 * a misrouted payload still compresses, still round-trips, and still reports a
 * percentage, so nothing looks wrong unless you check what the output is good for.
 *
 * The assertions are therefore about consequences, not labels. Calling a listing
 * `text` is harmless because `lines` is a legitimate fallback for it; what is not
 * harmless is a payload reaching a handler that destroys its structure. Each case
 * says which outcome it is protecting.
 *
 * Run with: node bench/probe-detection.mjs
 */

import { compress, detectKind, getEngine } from '../lib/engine.js'

let findings = 0
const log = []
const note = (kind, name, detail) => {
  log.push(kind.padEnd(5) + name.padEnd(46) + detail)
  if (kind === 'BUG' || kind === 'FAIL') findings += 1
}

const engine = getEngine({ storeMax: 256, ttlMs: 60_000 })

/** Compress and assert the round trip, returning the result. */
function run(label, content) {
  const result = compress(content, { store: engine.store })
  if (result.stored === false) return { ...result, label }
  const back = engine.store.find(result.token)
  if (back.kind !== 'found' || back.entry.text !== content) {
    note('BUG', label + ': round trip', 'store says ' + back.kind)
  }
  return { ...result, label }
}

const parses = (text) => {
  try {
    JSON.parse(text.split('\n')[0])
    return true
  } catch {
    return false
  }
}

// ── unambiguous shapes must be named correctly ─────────────────────────────

const obvious = [
  ['plain object', JSON.stringify({ a: 1, b: 'two', c: [1, 2, 3] }, null, 2), 'json'],
  ['array of records', JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: i, v: 'x'.repeat(40) })), null, 2), 'json'],
  ['unified diff', ['diff --git a/a b/a', '--- a/a', '+++ b/a', '@@ -1,3 +1,3 @@', '-old', '+new'].join('\n'), 'diff'],
  ['timestamped log', Array.from({ length: 40 }, (_, i) => '2026-03-14T09:00:00.000Z DEBUG line ' + i).join('\n'), 'log'],
  ['python source', ['import os', '', 'def f(x):', ...Array.from({ length: 20 }, (_, i) => '    y = x + ' + i + '\n    return y')].join('\n'), 'code'],
  ['prose document', Array.from({ length: 12 }, (_, i) => '## Section ' + i + '\n\nThe team considered the proposal at length during the review of the change. ' + 'It opens with a claim and closes with a decision. '.repeat(4)).join('\n\n'), 'text'],
]
for (const [label, content, expected] of obvious) {
  const detected = detectKind(content)
  note(detected === expected ? 'ok' : 'BUG', 'detects ' + label, 'expected ' + expected + ', got ' + detected)
}

// ── JSON that does not parse must still not be gutted ──────────────────────
//
// A truncated API page is the realistic case: it arrives mid-transfer, so it
// starts with `{`, fails to parse, and used to fall through to `code`, which
// kept the opening brace and masked everything else.

const page = JSON.stringify({ data: Array.from({ length: 20 }, (_, i) => ({ id: 'u' + i, bio: 'bio '.repeat(12) })) }, null, 2)
const jsonVariants = {
  'valid JSON': page,
  'truncated at 90%': page.slice(0, Math.floor(page.length * 0.9)),
  'truncated to 400 chars': page.slice(0, 400),
  'with a BOM': '\uFEFF' + page,
  'with a trailing note': page + '\n(trailing note)',
  'with a leading line': 'Fetched 20 records:\n' + page,
}
for (const [label, content] of Object.entries(jsonVariants)) {
  const result = run(label, content)
  const gutted = result.stored !== false && result.compressed.replace(/\s/g, '').length < 40
  note(!gutted ? 'ok' : 'BUG', 'JSON variant: ' + label,
    result.stored === false ? 'refused (original returned)' : 'ran ' + result.kind + ' at ' + result.savedPercent + '%')
  if (result.stored !== false && !gutted && result.kind === 'json') {
    note(parses(result.compressed) ? 'ok' : 'BUG', '  and still parses: ' + label, '')
  }
}

// ── brace-heavy non-JSON must still reach its own handlers ────────────────

const braceCases = {
  'C source': ['#include <stdio.h>', 'int main(void) {', ...Array.from({ length: 30 }, (_, i) => '  printf("line ' + i + '\\n");'), '  return 0;', '}'].join('\n'),
  'Java class': ['public class Big {', ...Array.from({ length: 30 }, (_, i) => '  public int m' + i + '(int x) {\n    int t = x * ' + i + ';\n    return t;\n  }'), '}'].join('\n'),
  'JavaScript module': ['const cache = new Map()', 'export function compute(input) {', ...Array.from({ length: 30 }, (_, i) => '  if (input > ' + i + ') return input * ' + i), '  return 0', '}'].join('\n'),
  'CSS': ['body {', ...Array.from({ length: 40 }, (_, i) => '  .rule' + i + ' { margin: ' + i + 'px; }'), '}'].join('\n'),
}
for (const [label, content] of Object.entries(braceCases)) {
  const result = run(label, content)
  note(
    result.stored !== false && result.savedPercent > 20 ? 'ok' : 'BUG',
    'brace language still compresses: ' + label,
    result.stored === false ? 'refused' : 'ran ' + result.kind + ' at ' + result.savedPercent + '%',
  )
}

// ── a brace language must not be mistaken for JSON and refused ────────────
for (const [label, content] of Object.entries(braceCases)) {
  const detected = detectKind(content)
  note(detected !== 'json' ? 'ok' : 'BUG', 'brace language is not detected as JSON: ' + label, 'got ' + detected)
}

// ── listing-ish payloads may land on `lines`; that is the design ──────────

const listings = {
  'directory listing': Array.from({ length: 400 }, (_, i) => '/opt/app/node_modules/pkg-' + i + '   ' + (2000 + i * 7)).join('\n'),
  'grep output': Array.from({ length: 300 }, (_, i) => 'src/mod' + (i % 40) + '.ts:' + (10 + i) + ':  const value = compute(' + i + ')').join('\n'),
  'test transcript': Array.from({ length: 300 }, (_, i) => '  ' + (i % 17 === 0 ? 'FAIL' : 'PASS') + '  suite' + (i % 4) + '.test.mjs: assertion ' + i).join('\n'),
}
for (const [label, content] of Object.entries(listings)) {
  const result = run(label, content)
  note(
    result.stored !== false && ['lines', 'text'].includes(result.kind) && result.savedPercent > 40 ? 'ok' : 'BUG',
    'listing-shaped payload sampled: ' + label,
    result.stored === false ? 'refused' : 'ran ' + result.kind + ' at ' + result.savedPercent + '%',
  )
}

// ── a diff must never be routed to a handler that loses the hunks ─────────

const diff = ['diff --git a/src/x.ts b/src/x.ts', 'index 1111111..2222222 100644', '--- a/src/x.ts', '+++ b/src/x.ts', '@@ -14,22 +14,26 @@ export class Renderer {']
  .concat(Array.from({ length: 60 }, (_, i) => '-  const previous = state.nodes[' + i + '] ?? fallback(' + i + ')'))
  .concat(Array.from({ length: 60 }, (_, i) => '+  const previous = resolveNode(state, ' + i + ', fallback)'))
  .join('\n')
const diffResult = run('diff', diff)
note(diffResult.kind === 'diff' ? 'ok' : 'BUG', 'a diff is handled by the diff handler', 'ran ' + diffResult.kind)
note(/@@ -14,22 \+14,26 @@/.test(diffResult.compressed) ? 'ok' : 'BUG', 'the hunk header survives', '')

// A diff whose only hunk header is present but whose body is prose-ish.
const proseDiff = ['--- old.txt', '+++ new.txt', '@@ -1,3 +1,3 @@', '-first line removed', '+first line added', ' context kept'].join('\n')
const proseDiffResult = run('short diff', proseDiff)
note(proseDiffResult.kind === 'diff' || proseDiffResult.stored === false ? 'ok' : 'BUG',
  'a short diff is not misrouted to code', 'ran ' + proseDiffResult.kind)

// ── JSONL: an honest report about a real gap ─────────────────────────────

const jsonl = Array.from({ length: 200 }, (_, i) => JSON.stringify({ ts: '2026-03-14T09:00:00Z', level: 'DEBUG', seq: i })).join('\n')
const jsonlResult = run('jsonl', jsonl)
note('ok', 'JSONL (one object per line)', 'detected ' + detectKind(jsonl) + ', ran ' + jsonlResult.kind +
  (jsonlResult.stored === false ? ', refused' : ', ' + jsonlResult.savedPercent + '%'))
if (jsonlResult.stored === false) {
  note('ok', '  JSONL is refused rather than half-parsed', 'the JSON handler cannot factor one object per line')
}

// ── report ─────────────────────────────────────────────────────────────────

console.log(log.join('\n'))
console.log('')
console.log(findings === 0 ? 'no findings in ' + log.length + ' checks' : findings + ' finding(s) across ' + log.length + ' checks')
process.exit(findings === 0 ? 0 : 1)

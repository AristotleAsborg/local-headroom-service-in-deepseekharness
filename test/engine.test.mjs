/**
 * Engine checks. Run with: node test/engine.test.mjs
 *
 * These assert behaviour a reader can verify, not implementation details:
 * every claim in the README has a case here.
 */

import { compress, getEngine, estimateTokens, detectKind, TokenStore } from '../lib/engine.js'

let passed = 0
let failed = 0

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log('  PASS  ' + name)
  } else {
    failed += 1
    console.log('  FAIL  ' + name + (detail === undefined ? '' : '\n        ' + detail))
  }
}

function engineFor() {
  return getEngine({ storeMax: 32, ttlMs: 60_000 })
}

function roundTrip(name, content, engine, expectedKind) {
  const result = compress(content, { store: engine.store, kind: 'auto' })
  check(name + ': detected ' + expectedKind, result.kind === expectedKind, 'got ' + result.kind)
  check(name + ': compressed', result.stored === true, 'note=' + String(result.note))
  if (result.stored !== true) return result
  check(name + ': saved tokens', result.savedTokens > 0, String(result.savedTokens))
  check(name + ': tokens fell', result.compressedTokens < result.originalTokens, result.compressedTokens + ' vs ' + result.originalTokens)
  const back = engine.store.find(result.token)
  check(name + ': retrievable', back.kind === 'found')
  check(name + ': lossless', back.kind === 'found' && back.entry.text === content, 'stored text differs')
  console.log('        -> ' + result.savedPercent + '% saved, ' + result.transforms.join(', '))
  return result
}

// ── estimator ───────────────────────────────────────────────────────────────

console.log('\nestimator')
check('empty is zero', estimateTokens('') === 0)
check('ascii prose is priced', estimateTokens('the quick brown fox jumps over the lazy dog') > 5)
check('cjk is priced per glyph', estimateTokens('上下文工程工具') >= 7)
check('a hash is not cheap', estimateTokens('a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6') >= 10)

// ── detection ───────────────────────────────────────────────────────────────

console.log('\ndetection')
check('json object', detectKind('{"a": 1, "b": [1,2,3]}') === 'json')
check('json array', detectKind('[{"a":1},{"b":2}]') === 'json')
check('code', detectKind('import os\n\ndef main():\n    return 1\n') === 'code')
check('log', detectKind('2026-01-01T10:00:00 INFO start\n2026-01-01T10:00:01 WARN slow\n2026-01-01T10:00:02 ERROR boom\n') === 'log')
check('plain text', detectKind('This is a paragraph of ordinary prose about nothing in particular.') === 'text')
check('diff', detectKind('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-a\n+b\n') === 'diff')

// ── JSON: keys preserved, bulk values masked ────────────────────────────────

console.log('\njson handler')
const jsonContent = JSON.stringify({
  users: Array.from({ length: 40 }, (_, index) => ({
    id: 'usr_' + String(index).padStart(6, '0'),
    name: 'User Number ' + index,
    email: 'user' + index + '@example.com',
    bio: 'A long biographical description that goes on and on for this particular user, number ' + index + ', with plenty of detail that nobody needs to read twice.',
  })),
  total: 40,
  page: 1,
  hasMore: false,
})
const jsonEngine = engineFor()
jsonEngine.record = () => {}
const jsonResult = roundTrip('json', jsonContent, jsonEngine, 'json')
// The key set is stated once, inside the marker itself, so the schema stays
// visible without a lookup. This replaced an earlier contract that repeated
// every key on every record — and a later one that hid the keys behind a token
// nothing had stored.
check('json: records are factored into rows', jsonResult.transforms.includes('json:records-factored'), jsonResult.transforms.join(', '))
check('json: schema is stated in the marker', /<<hr:schema:hidden=\d+:[0-9a-f]+:\w+\|/.test(jsonResult.compressed), jsonResult.compressed.slice(0, 200))
check('json: the schema names the record keys', jsonResult.compressed.includes('name|email') || jsonResult.compressed.includes('id|name'), jsonResult.compressed.slice(0, 200))
check('json: short values survive', jsonResult.compressed.includes('usr_000000'))
check('json: booleans survive', jsonResult.compressed.includes('false'))
check('json: output is valid-ish JSON', (() => {
  try {
    JSON.parse(jsonResult.compressed)
    return true
  } catch {
    return false
  }
})())

// ── json: the two structural optimizations ─────────────────────────────────

console.log('\njson factoring')
// A map of same-shaped records: the lockfile shape, where the outer keys are
// names and the inner key set is the schema.
const lockfile = JSON.stringify({
  name: 'x',
  lockfileVersion: 3,
  packages: Object.fromEntries(
    Array.from({ length: 25 }, (_, index) => [
      'node_modules/dsh-module-' + index,
      {
        version: '0.1.5-rc.' + index,
        resolved: 'https://registry.npmjs.org/@deepseek-ai/dsh-module-' + index + '/-/dsh-module-' + index + '.tgz',
        integrity: 'sha512-' + String(index).repeat(43).slice(0, 86),
        license: 'MIT',
        dependencies: { 'dsh-util-values': '^0.1.5-rc.2' },
      },
    ]),
  ),
}, null, 2)
const lockEngine = engineFor()
lockEngine.record = () => {}
const lockResult = compress(lockfile, { store: lockEngine.store })
check('lockfile: factored into rows', lockResult.transforms.includes('json:records-factored'), lockResult.transforms.join(', '))
check('lockfile: key table hoisted', lockResult.transforms.includes('json:keys-hoisted'), lockResult.transforms.join(', '))
// The legend is one marker per hoisted key set: `<<hr:keys:hidden=2:<digest>:K1=a|b>>`.
// Key lists use SCHEMA_SEPARATOR, which `isBlank`-trimmed output renders as `|`;
// a hyphen is part of ordinary key names. (Writing `[\w$|]` looked like
// alternation but is a literal pipe, which silently excluded `-`.)
//
// It used to be appended as bare lines (`K1 = id|name`), which left the document
// trailing text after its closing brace and, worse, made the one elision in the
// payload that carried no marker: a reader could not tell it apart from content
// that had survived.
check(
  'lockfile: the hoisted key list is stated in a marker, not hidden behind a token',
  /<<hr:keys:hidden=\d+:[0-9a-f]+:K\d+=[A-Za-z_$][\w$|-]*>>/.test(lockResult.compressed),
  lockResult.compressed.split('\n').filter((line) => line.startsWith('<<hr:keys')).join(' | '),
)
check(
  'lockfile: the legend does not leave bare prose after the document',
  !/^K\d+ = /m.test(lockResult.compressed),
  lockResult.compressed.split('\n').filter((line) => /^K\d+ = /.test(line)).join(' | '),
)
check('lockfile: the key table appears once, not per record', (lockResult.compressed.match(/"integrity":/g) ?? []).length === 0)
check('lockfile: shrinks a lot', lockResult.savedPercent > 45, String(lockResult.savedPercent) + '%')
const lockBack = lockEngine.store.find(lockResult.token)
check('lockfile: round trip is byte-exact', lockBack.kind === 'found' && lockBack.entry.text === lockfile)

// A bulky value must never be replaced by a marker that costs more than it.
const bulky = JSON.stringify({
  items: Array.from({ length: 12 }, (_, index) => ({ hash: 'sha512-' + String(index).repeat(43).slice(0, 86) })),
})
const bulkyEngine = engineFor()
bulkyEngine.record = () => {}
const bulkyResult = compress(bulky, { store: bulkyEngine.store })
check(
  'bulky values are kept when a marker would cost more',
  bulkyResult.stored === false || bulkyResult.compressedTokens <= bulkyResult.originalTokens,
  bulkyResult.originalTokens + ' -> ' + bulkyResult.compressedTokens,
)

// A short key cannot pay for an alias, and aliasing must never break the JSON.
// An earlier version replaced `{"seats":` with `"K1":`, which is not a JSON
// object at all: the payload was silently corrupted while still "compressing".
const shortKeys = JSON.stringify({
  data: Array.from({ length: 40 }, (_, index) => ({ id: 'x' + index, n: index })),
})
const shortEngine = engineFor()
shortEngine.record = () => {}
const shortResult = compress(shortKeys, { store: shortEngine.store })
check('short keys are not aliased', !shortResult.transforms.includes('json:keys-hoisted'), shortResult.transforms.join(', '))
check('short-key output still parses as JSON', (() => {
  try {
    JSON.parse(shortResult.compressed)
    return true
  } catch {
    return false
  }
})(), shortResult.compressed.slice(0, 160))

// Every json result must stay parseable, whatever transforms fired.
const parseable = [
  ['api page', JSON.stringify({ data: Array.from({ length: 30 }, (_, i) => ({ id: 'u' + i, email: 'p' + i + '@x.com', active: i % 2 === 0 })), total: 30 })],
  ['nested map', JSON.stringify({ groups: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, c: { x: 5, y: 6 } }, tail: true })],
  ['array of arrays', JSON.stringify({ rows: [[1, 2], [3, 4], [5, 6], [7, 8]] })],
  // Nested factoring: an outer run of same-shaped records whose values are
  // themselves runs. `factorRecords` serializes rows while the tree is still
  // being walked, so a row carrying an already-factored value used to be written
  // by `JSON.stringify` as `{"__hrRaw":"..."}` — a quoted, escaped JSON string.
  // The payload stayed *syntactically* valid, which is why the flat cases above
  // never caught it, but the region's values were never walked: its bulk was
  // never masked, so it cost more than the records it replaced.
  ['nested factored array', JSON.stringify({
    vectors: Array.from({ length: 5 }, (_, index) => ({
      id: 'vec-' + index,
      description: 'Vector ' + index + ' asserts a surface cut is rejected, at some length.',
      input: {
        events: Array.from({ length: 5 }, (_, inner) => ({
          seq: inner + 1,
          type: ['user/message', 'assistant/message', 'tool/result'][inner % 3],
          payload: { text: 'body text number ' + inner + ' of vector ' + index, tokens: 40 + inner },
        })),
      },
      expect: { accepted: index % 3 !== 0, reason: index % 3 === 0 ? 'unbalanced' : 'ok' },
    })),
  })],
  ['nested factored map', JSON.stringify({
    byId: Object.fromEntries(Array.from({ length: 5 }, (_, index) => ['v' + index, {
      id: 'v' + index,
      description: 'Record ' + index + ' describes the assertion at some length.',
      input: {
        events: Array.from({ length: 5 }, (_, inner) => ({
          seq: inner + 1,
          type: ['user/message', 'assistant/message', 'tool/result'][inner % 3],
          payload: { text: 'body text number ' + inner + ' of record ' + index, tokens: 40 + inner },
        })),
      },
      expect: { accepted: true, reason: 'ok' },
    }])),
  })],
]
for (const [label, document] of parseable) {
  const holder = engineFor()
  holder.record = () => {}
  const result = compress(document, { store: holder.store, kind: 'json' })
  // A compressed json document is the json text, then one marker line per hoisted
  // key set. Only the document itself is expected to parse.
  const block = result.compressed.slice(0, result.compressed.indexOf('\n') === -1 ? undefined : result.compressed.indexOf('\n'))
  const parses = (() => {
    try {
      JSON.parse(block)
      return true
    } catch {
      return false
    }
  })()
  check('json stays parseable: ' + label, parses, result.compressed.slice(0, 160))
  check('json never emits a raw sentinel: ' + label, !result.compressed.includes('__hrRaw'), result.compressed.slice(0, 160))
  const restored = holder.store.find(result.token)
  check('json round trip: ' + label, result.stored === false || (restored.kind === 'found' && restored.entry.text === document))
}

// ── code: signatures preserved, bodies masked ───────────────────────────────

console.log('\ncode handler')
const codeContent = [
  'import os',
  'from typing import List, Dict',
  '',
  'MAX_ITEMS = 100',
  '',
  'def process_data(items: List[str]) -> Dict[str, int]:',
  '    """Process items and count occurrences."""',
  '    result = {}',
  '    for item in items:',
  '        item = item.strip().lower()',
  '        if item in result:',
  '            result[item] += 1',
  '        else:',
  '            result[item] = 1',
  '    return result',
  '',
  'class ReportWriter:',
  '    def __init__(self, path: str):',
  '        self.path = path',
  '        self.rows = []',
  '        self.header = None',
  '',
  '    def write(self, row: Dict[str, int]) -> None:',
  '        with open(self.path, "w") as handle:',
  '            for key, value in row.items():',
  '                handle.write(key + "=" + str(value) + "\\n")',
  '            handle.flush()',
  '',
  'def main() -> None:',
  '    data = process_data(["a", "b", "a"])',
  '    writer = ReportWriter("out.txt")',
  '    writer.write(data)',
  '',
  'if __name__ == "__main__":',
  '    main()',
].join('\n')
const codeEngine = engineFor()
codeEngine.record = () => {}
const codeResult = roundTrip('code', codeContent, codeEngine, 'code')
check('code: import kept', codeResult.compressed.includes('import os'))
check('code: signature kept', codeResult.compressed.includes('def process_data(items: List[str]) -> Dict[str, int]:'))
check('code: class kept', codeResult.compressed.includes('class ReportWriter:'))
check('code: bodies masked', codeResult.compressed.includes('<<hr:body:'))

// ── code handler: brace languages ───────────────────────────────────────────
//
// The Python fixture above passed while the handler was a no-op on every other
// language, because each `def` happened to match a keyword. These cases are the
// guard that was missing: a real brace-language file must actually shrink, and
// its skeleton must survive.

const tsClass = [
  'export class Cache {',
  ...Array.from({ length: 20 }, (_, index) => [
    '  compute' + index + '(input: number[]): number {',
    '    let total = 0',
    '    const offset = ' + (index * 7 + 3),
    '    for (const value of input) {',
    '      if (value % 2 === 0) total += value * ' + (index + 1) + ' + offset',
    '      else total -= value - offset',
    '    }',
    '    return total % 1000003',
    '  }',
    '',
  ]).flat(),
  '}',
].join('\n')

const tsEngine = engineFor()
tsEngine.record = () => {}
const tsResult = compress(tsClass, { store: tsEngine.store })
check('ts: detected as code', detectKind(tsClass) === 'code', detectKind(tsClass))
check('ts: code handler actually shrinks a real file', tsResult.stored === true && tsResult.savedTokens > 0, 'saved=' + String(tsResult.savedTokens) + ' note=' + String(tsResult.note))
check('ts: class declaration kept', tsResult.compressed.includes('export class Cache {'))
check('ts: method signature kept', tsResult.compressed.includes('compute0(input: number[]): number {'))
check('ts: bodies masked', tsResult.compressed.includes('<<hr:body:'))
check('ts: every body is masked, not just the first', (tsResult.compressed.match(/<<hr:body:/g) ?? []).length >= 15, String((tsResult.compressed.match(/<<hr:body:/g) ?? []).length))
const tsBack = tsEngine.store.find(tsResult.token)
check('ts: round trip is byte-exact', tsBack.kind === 'found' && tsBack.entry.text === tsClass)

// A tiny body cannot pay for its marker, so the handler must leave it alone
// rather than emit output larger than its input.
const tinyCodeEngine = engineFor()
tinyCodeEngine.record = () => {}
const tinyCode = 'function f(a) {\n  const x = a + 1\n  return x\n}\n'
const tinyResult = compress(tinyCode, { store: tinyCodeEngine.store })
check('tiny code is left alone rather than inflated', tinyResult.compressedTokens <= tinyResult.originalTokens, tinyResult.originalTokens + '->' + tinyResult.compressedTokens)

// A body large enough to pay for its marker must be masked: this is the
// indentation rule working (`function f(a) {` is not the only opener form).
const body = Array.from({ length: 30 }, (_, index) => '  const value' + index + ' = compute(' + index + ')').join('\n')
const fnSource = 'function big(a) {\n' + body + '\n  return value0\n}\n'
const fnEngine = engineFor()
fnEngine.record = () => {}
const fnResult = compress(fnSource, { store: fnEngine.store })
check('braced function body is masked', fnResult.stored === true && fnResult.compressed.includes('<<hr:body:'), 'stored=' + fnResult.stored)
check('braced function keeps its signature', fnResult.compressed.includes('function big(a) {'))
check('braced function round trip', (() => {
  const back = fnEngine.store.find(fnResult.token)
  return back.kind === 'found' && back.entry.text === fnSource
})())

// ── log: levels preserved, repetition thinned ───────────────────────────────

console.log('\nlog handler')
const logContent = [
  ...Array.from({ length: 200 }, (_, index) => '2026-01-01T10:' + String(index % 60).padStart(2, '0') + ':00 INFO routine heartbeat number ' + index + ' all systems nominal'),
  '2026-01-01T10:30:00 WARN disk usage at 81 percent on /var',
  '2026-01-01T10:30:01 ERROR failed to flush buffer: connection reset by peer',
  '    at com.example.Stream.flush(Stream.java:214)',
  '    at com.example.Writer.write(Writer.java:88)',
  '    at com.example.Main.main(Main.java:12)',
  ...Array.from({ length: 100 }, (_, index) => '2026-01-01T10:31:' + String(index % 60).padStart(2, '0') + ':00 DEBUG retry attempt ' + index + ' backoff 250ms'),
].join('\n')
const logEngine = engineFor()
logEngine.record = () => {}
const logResult = roundTrip('log', logContent, logEngine, 'log')
check('log: error kept', logResult.compressed.includes('ERROR failed to flush buffer'))
check('log: warn kept', logResult.compressed.includes('WARN disk usage'))
check('log: stack lines kept', logResult.compressed.includes('Stream.java:214'))
check('log: heartbeat run thinned', logResult.compressed.includes('<<hr:log:'))

/**
 * The guarantee: every fatal and error line survives, however many there are.
 *
 * The README promises this and the sampling used to ignore it — `spread` was
 * applied per level regardless of what the level meant, so 300 ERROR lines came
 * back as 24. That is the one claim in this handler a reader relies on without
 * checking: "the errors are all here" is why a compressed log is usable.
 *
 * WARN is deliberately not covered. It is numerous in healthy systems, and
 * thinning it is a normal trade; thinning errors is not.
 */
const seriousCount = (text) => (text.match(/\b(?:FATAL|CRITICAL|SEVERE|ERROR|ERR)\b/g) ?? []).length
const severities = new Map()
for (const [label, level, count] of [
  ['300 ERROR', 'ERROR', 300],
  ['400 FATAL', 'FATAL', 400],
  ['12 ERROR among 500 DEBUG', 'ERROR', 12],
]) {
  const body = level === 'ERROR' && count === 12
    ? Array.from({ length: 500 }, (_, i) => '2026-01-01T10:00:00 DEBUG heartbeat ' + i).join('\n') + '\n' +
      Array.from({ length: count }, (_, i) => '2026-01-01T10:01:00 ERROR failure ' + i).join('\n')
    : Array.from({ length: count }, (_, i) => '2026-01-01T10:00:00 ' + level + '  event ' + i).join('\n')
  const holder = engineFor()
  holder.record = () => {}
  const result = compress(body, { store: holder.store, kind: 'log' })
  const before = seriousCount(body)
  const after = seriousCount(result.compressed)
  severities.set(label, { before, after, saved: result.savedPercent })
  check('log: ' + label + ' lines all survive', after >= before,
    before + ' -> ' + after + ' at ' + result.savedPercent + '% saved')
}

// WARN is sampled, which is the documented difference between it and errors.
{
  const body = Array.from({ length: 300 }, (_, i) => '2026-01-01T10:00:00 WARN pressure ' + i).join('\n')
  const holder = engineFor()
  holder.record = () => {}
  const result = compress(body, { store: holder.store, kind: 'log' })
  check('log: WARN is sampled, not guaranteed', seriousCount(result.compressed) === 0 && result.savedPercent > 70,
    'saved ' + result.savedPercent + '% with ' + seriousCount(result.compressed) + ' WARN tokens left')
}

/**
 * A repeated error is the clearest case for factoring in this handler.
 *
 * The information is the message and how many times it happened, not three
 * hundred copies of it. Factor runs the picker KEPT were never templated, which
 * was invisible while every level got sampled and became the dominant cost once
 * errors were guaranteed: a service logging the same error 300 times kept all
 * 300 and the payload shrank by 17%.
 */
{
  const flood = Array.from({ length: 300 }, () => '2026-01-01T10:00:00 ERROR downstream unavailable: connection reset').join('\n')
  const holder = engineFor()
  holder.record = () => {}
  const result = compress(flood, { store: holder.store, kind: 'log' })
  check('log: a repeated identical error is factored, not repeated 300 times',
    result.transforms.includes('log:repeats-factored') && result.savedPercent > 90,
    result.transforms.join(', ') + ' at ' + result.savedPercent + '%')
  check('log: the factored flood still round-trips byte-exact', (() => {
    const back = holder.store.find(result.token)
    return back.kind === 'found' && back.entry.text === flood
  })())
  check('log: the count is stated in the output', /300 similar lines/.test(result.compressed),
    result.compressed.split('\n')[0].slice(0, 100))
}

// A short run is left alone: the repetition is often the signal, and deduplicating
// three identical lines saves almost nothing while reading worse.
{
  const shortRun = Array.from({ length: 4 }, () => '2026-01-01T10:00:00 ERROR same thing happened').join('\n')
  const holder = engineFor()
  holder.record = () => {}
  const result = compress(shortRun, { store: holder.store, kind: 'log' })
  check('log: a short identical run is not factored away',
    result.stored === false || !result.transforms.includes('log:repeats-factored'),
    result.stored === false ? 'refused' : result.transforms.join(', '))
}

// ── diff ────────────────────────────────────────────────────────────────────

console.log('\ndiff handler')
const diffContent = [
  'diff --git a/src/app.js b/src/app.js',
  'index 1234567..89abcde 100644',
  'file-a/src/app.js',
  'file-b/src/app.js',
  '@@ -1,40 +1,42 @@',
  ...Array.from({ length: 30 }, (_, index) => '-' + 'removed line ' + index + ' with a fair amount of trailing detail'),
  ...Array.from({ length: 30 }, (_, index) => '+' + 'added line ' + index + ' with a fair amount of trailing detail'),
  ' context line kept between changes',
].join('\n')
const diffEngine = engineFor()
diffEngine.record = () => {}
const diffResult = roundTrip('diff', diffContent, diffEngine, 'diff')
check('diff: header kept', diffResult.compressed.includes('diff --git a/src/app.js b/src/app.js'))
check('diff: hunk header kept', diffResult.compressed.includes('@@ -1,40 +1,42 @@'))

// ── text ────────────────────────────────────────────────────────────────────

console.log('\ntext handler')
const textContent = Array.from({ length: 24 }, (_, index) =>
  'Section ' + index + ' explains a topic in depth. It opens with a claim about the subject at hand. ' +
  'The middle of the paragraph wanders through supporting detail, examples, caveats and qualifications ' +
  'that a reader skimming for the point does not need. It closes by restating where the argument landed.',
).join('\n\n')
const textEngine = engineFor()
textEngine.record = () => {}
const textResult = roundTrip('text', textContent, textEngine, 'text')
check('text: first block kept', textResult.compressed.includes('Section 0 explains'))
check('text: last block kept', textResult.compressed.includes('Section 23 explains'))

/**
 * `text:headings-kept` has to mean it.
 *
 * The report claimed headings were kept while the document path collapsed
 * everything between the first two and last two blocks into one marker — and a
 * heading glued to the paragraph below it lives in that block, so it went with
 * it. On a 20-section record, 19 of 20 headings disappeared behind a single
 * `<<hr:para:...>>` and the transform list still said `headings-kept`.
 *
 * A collapse that hides most of a document is a legitimate trade; claiming to
 * preserve the navigation while dropping it is not.
 */
const headingCount = (text) => (text.match(/^#{1,6} \S/gm) ?? []).length

const buriedHeadings = ['# Title', '', 'Status: accepted.', ''].concat(
  Array.from({ length: 20 }, (_, index) =>
    '### Decision ' + index + ': adopt the staged rollout approach\n\n' +
    'The team considered proposal ' + index + ' at length during the review. It opens by claiming the change reduces ' +
    'coupling between the modules under discussion. The middle walks through supporting detail, prior art and ' +
    'benchmarks that a reader skimming for the decision does not need. It closes by restating the decision.'),
).join('\n\n')
const headingEngine = engineFor()
headingEngine.record = () => {}
const headingResult = compress(buriedHeadings, { store: headingEngine.store, kind: 'text' })
check(
  'text: a document collapse still keeps every heading',
  headingCount(headingResult.compressed) === headingCount(buriedHeadings),
  headingCount(headingResult.compressed) + ' of ' + headingCount(buriedHeadings) + ' headings survived',
)
check(
  'text: `headings-kept` is not claimed when headings were dropped',
  !headingResult.transforms.includes('text:headings-kept') ||
    headingCount(headingResult.compressed) === headingCount(buriedHeadings),
  headingResult.transforms.join(', '),
)
check(
  'text: the collapse still saves materially with the skeleton',
  headingResult.savedPercent > 60,
  headingResult.savedPercent + '%',
)
check(
  'text: a heading glued to prose is not lost when that block is masked',
  (() => {
    const para = 'The team considered the proposal at length during the review. It opens by claiming the change reduces ' +
      'coupling between the modules. The middle walks through supporting detail, prior art and benchmarks a reader ' +
      'skimming does not need. It closes by restating the decision and the reasoning that carried it.'
    const doc = ['# Title', '', '### Alpha\n\n' + para, '### Beta\n\n' + para, '### Gamma\n\n' + para, '### Delta\n\n' + para].join('\n\n')
    const probe = engineFor()
    probe.record = () => {}
    const result = compress(doc, { store: probe.store, kind: 'text' })
    return headingCount(result.compressed) === headingCount(doc)
  })(),
)

// ── newline-delimited JSON ─────────────────────────────────────────────────
//
// JSONL is a mainstream shape — log shippers, bulk exports and streaming APIs all
// emit it — and it had no handler. `JSON.parse` refuses the document because it is
// many documents, so the JSON handler returned null and the payload was refused
// outright: hundreds of structured records, kept whole, with nothing done.

console.log('\njsonl')
{
  const records = Array.from({ length: 200 }, (_, index) =>
    JSON.stringify({ ts: '2026-03-14T09:00:00Z', level: 'DEBUG', seq: index, msg: 'event ' + index }))
  const content = records.join('\n')
  const holder = engineFor()
  holder.record = () => {}
  const result = compress(content, { store: holder.store })
  check('jsonl: a stream of records is handled', result.kind === 'jsonl' && result.stored !== false,
    'ran ' + result.kind + (result.stored === false ? ' (refused)' : ' at ' + result.savedPercent + '%'))
  check('jsonl: it saves materially', result.savedPercent > 25, result.savedPercent + '%')
  check('jsonl: the schema is stated once', /<<hr:schema:[^>]*ts\|level\|seq\|msg>>/.test(result.compressed),
    result.compressed.split('\n')[0].slice(0, 120))
  check('jsonl: the round trip is byte-exact', (() => {
    const back = holder.store.find(result.token)
    return back.kind === 'found' && back.entry.text === content
  })())
}

// Below the factoring floor it must refuse rather than half-parse.
{
  const holder = engineFor()
  holder.record = () => {}
  const small = compress(Array.from({ length: 3 }, (_, i) => JSON.stringify({ a: i })).join('\n'), { store: holder.store })
  check('jsonl: three tiny records are refused, not mangled',
    small.stored === false || small.kind === 'jsonl', 'ran ' + small.kind)
}

// A stream whose records do not share a key set cannot be written positionally.
{
  const holder = engineFor()
  holder.record = () => {}
  const ragged = Array.from({ length: 60 }, (_, i) => JSON.stringify(i % 2 === 0 ? { a: i, pad: 'x'.repeat(40) } : { a: i, b: 1, pad: 'x'.repeat(40) })).join('\n')
  const result = compress(ragged, { store: holder.store })
  check('jsonl: a ragged stream is not written as positional rows',
    result.stored === false || !/<<hr:schema:/.test(result.compressed),
    'ran ' + result.kind + (result.stored === false ? ' (refused)' : ''))
}

// A scalar-per-line stream is not JSONL: there are no keys to factor.
{
  const holder = engineFor()
  holder.record = () => {}
  const scalars = Array.from({ length: 60 }, (_, i) => String(i * 7)).join('\n')
  const result = compress(scalars, { store: holder.store })
  check('jsonl: a scalar-per-line stream is not treated as records',
    result.stored === false || result.kind !== 'jsonl', 'ran ' + result.kind)
}

// ── JSON-shaped payloads must not reach a handler that guts them ────────────

console.log('\njson-shaped guard')
{
  // Truncated, BOM-prefixed, and trailing-junk JSON all start with `{` and fail
  // to parse. Each used to fall through to `code`, which kept the opening brace
  // and masked everything else.
  const page = JSON.stringify(
    { data: Array.from({ length: 20 }, (_, i) => ({ id: 'u' + i, bio: 'bio '.repeat(12) })) },
    null,
    2,
  )
  const variants = {
    'valid': page,
    'truncated at 90%': page.slice(0, Math.floor(page.length * 0.9)),
    'truncated to 400 chars': page.slice(0, 400),
    'with a BOM': '\uFEFF' + page,
    'with trailing junk': page + '\n(trailing note)',
  }
  let gutted = 0
  let uncompressed = 0
  for (const [label, content] of Object.entries(variants)) {
    const holder = engineFor()
    holder.record = () => {}
    const result = compress(content, { store: holder.store })
    if (result.stored === false) {
      uncompressed += 1
      // A refusal must return the input untouched, or the caller has neither the
      // compressed form nor the original.
      if (result.compressed !== content) check('json-shaped: refusal returns the input — ' + label, false, '')
      continue
    }
    // A gutted result is a few dozen characters of punctuation and a marker.
    if (result.compressed.replace(/\s/g, '').length < 40) {
      gutted += 1
      check('json-shaped: not gutted — ' + label, false, JSON.stringify(result.compressed.slice(0, 80)))
    }
  }
  check('json-shaped: no variant is gutted', gutted === 0, gutted + ' gutted')
  check('json-shaped: variants are either compressed legibly or refused whole',
    gutted === 0 && uncompressed >= 3, uncompressed + ' refused, ' + (Object.keys(variants).length - uncompressed) + ' compressed')
}

// ── the heading skeleton announces itself ─────────────────────────────────

{
  const para = 'The team considered the proposal at length during the review. It opens by claiming the change reduces ' +
    'coupling between the modules. The middle walks through supporting detail that a reader skimming does not need. ' +
    'It closes by restating the decision and the reasoning that carried it.'
  const doc = ['# Title', '', 'Status: accepted.', ''].concat(
    Array.from({ length: 20 }, (_, i) => '### Decision ' + i + '\n\n' + para),
  ).join('\n\n')
  const holder = engineFor()
  holder.record = () => {}
  const result = compress(doc, { store: holder.store, kind: 'text' })
  check('text: restoring dropped headings is reported as a repair',
    result.transforms.includes('text:skeleton-added'),
    result.transforms.join(', '))
}

// ── fallback selection may not gut a document ──────────────────────────────
//
// "Keep the most text" measures size, and size cannot tell a conservative
// transform from a destructive one. On a small JSON array the JSON handler kept
// every record and the key schema at 9.7% — just under the 12% floor — so it was
// unusable and the fallback took `code`, which masked the entire body and
// reported 90.9%. What the caller got was `[\n<<hr:body:hidden=580>>\n]`: only
// the brackets survived, and every key and record sat behind a digest.
//
// Valid JSON must not be handed to a handler that cannot keep it valid.

console.log('\nfallback selection')
const fallbackEngine = engineFor()
fallbackEngine.record = () => {}

const smallPage = JSON.stringify(
  Array.from({ length: 6 }, (_, index) => ({ id: index, body: 'b'.repeat(60) })),
  null,
  2,
)
const smallPageResult = compress(smallPage, { store: fallbackEngine.store })
check(
  'valid JSON is never routed to a handler that breaks it',
  smallPageResult.stored === false || smallPageResult.kind === 'json',
  'ran ' + smallPageResult.kind + ' at ' + smallPageResult.savedPercent + '%',
)
check(
  'json that cannot be shrunk cleanly is refused, not gutted',
  smallPageResult.stored === false
    ? smallPageResult.compressed === smallPage
    : JSON.parse(smallPageResult.compressed.split('\n')[0]) !== undefined,
  JSON.stringify(smallPageResult.compressed).slice(0, 120),
)

// A page large enough for the JSON handler to clear the floor still goes through
// the JSON handler, and still parses.
const bigPage = JSON.stringify(
  { data: Array.from({ length: 20 }, (_, index) => ({ id: 'u' + index, bio: 'bio '.repeat(12) })) },
  null,
  2,
)
const bigPageEngine = engineFor()
bigPageEngine.record = () => {}
const bigPageResult = compress(bigPage, { store: bigPageEngine.store })
check('a larger JSON page still compresses as JSON', bigPageResult.kind === 'json' && bigPageResult.savedTokens > 0,
  bigPageResult.kind + ' at ' + bigPageResult.savedPercent + '%')
check('and its document still parses', (() => {
  try {
    JSON.parse(bigPageResult.compressed.split('\n')[0])
    return true
  } catch {
    return false
  }
})())

// The guard must not touch non-JSON content: a listing is still sampled, and a
// source file is still reduced to signatures.
const listingEngine = engineFor()
listingEngine.record = () => {}
const listing = Array.from({ length: 300 }, (_, index) => '/opt/app/pkg-' + index + '   ' + (2000 + index)).join('\n')
check('a listing still falls back to sampling', compress(listing, { store: listingEngine.store }).kind === 'lines')

// ── honesty guards ──────────────────────────────────────────────────────────

console.log('\nhonesty')
const tinyEngine = engineFor()
tinyEngine.record = () => {}
const tiny = compress('short', { store: tinyEngine.store })
check('tiny input is refused', tiny.stored === false && tiny.compressed === 'short', JSON.stringify(tiny.note))
check('tiny input reports zero saved', tiny.savedTokens === 0)

const proseEngine = engineFor()
proseEngine.record = () => {}
const prose = compress('one two three four five six seven eight nine ten', { store: proseEngine.store })
check('incompressible prose refused', prose.stored === false, 'note=' + String(prose.note))

const unicodeContent = 'héllo wörld\n\n' + 'ünïcode séntence with áccents. '.repeat(400)
const unicodeEngine = engineFor()
unicodeEngine.record = () => {}
const unicodeResult = compress(unicodeContent, { store: unicodeEngine.store, kind: 'text' })
if (unicodeResult.stored === true) {
  const back = unicodeEngine.store.find(unicodeResult.token)
  check('unicode round trip', back.kind === 'found' && back.entry.text === unicodeContent)
} else {
  check('unicode handled without throwing', true)
}

// ── store behaviour ─────────────────────────────────────────────────────────

console.log('\nstore')
const store = new TokenStore({ max: 2, ttlMs: 1000 })
store.put('aaa', { hash: 'aaa', text: 'one', kind: 'text', tokens: 1, createdAt: Date.now() })
store.put('bbb', { hash: 'bbb', text: 'two', kind: 'text', tokens: 1, createdAt: Date.now() + 1 })
store.put('ccc', { hash: 'ccc', text: 'three', kind: 'text', tokens: 1, createdAt: Date.now() + 2 })
check('capacity evicts oldest', store.describe().entries === 2 && store.find('aaa').kind === 'missing')
check('prefix resolves uniquely', (() => {
  const probe = new TokenStore({ max: 4, ttlMs: 1000 })
  probe.put('aabbcc', { hash: 'aabbcc', text: 'x', kind: 'text', tokens: 1, createdAt: Date.now() })
  return probe.find('aab').kind === 'found'
})())
check('ambiguous prefix is reported', (() => {
  const probe = new TokenStore({ max: 4, ttlMs: 1000 })
  const now = Date.now()
  probe.put('aabbcc', { hash: 'aabbcc', text: 'x', kind: 'text', tokens: 1, createdAt: now })
  probe.put('aabbdd', { hash: 'aabbdd', text: 'y', kind: 'text', tokens: 1, createdAt: now })
  return probe.find('aabb').kind === 'ambiguous'
})())
check('ttl expiry', (() => {
  const probe = new TokenStore({ max: 4, ttlMs: 1 })
  probe.put('zz', { hash: 'zz', text: 'x', kind: 'text', tokens: 1, createdAt: Date.now() - 10 })
  return probe.find('zz').kind === 'missing'
})())

// The store's writer and its reader must agree about what time it is.
//
// `put` stamps an entry and expires it in the same call. Expiring against the
// wall clock while the caller supplied `createdAt` mixed two time references, so
// an entry written with an explicit `now` was treated as ancient and deleted the
// instant it was inserted. Nothing downstream noticed, because in a live session
// both are `Date.now()`; it only surfaced when a test worked in a fixed frame of
// reference, which is exactly what `compress({ now })` exists to allow.
check('an entry stored at an explicit now is readable in the same frame', (() => {
  const T = 1_000_000
  const probe = new TokenStore({ max: 4, ttlMs: 1000 })
  probe.put('explicit', { hash: 'explicit', text: 'x', kind: 'text', tokens: 1 }, T)
  return probe.find('explicit', T + 500).kind === 'found'
})())
check('the ttl boundary holds on both sides', (() => {
  const T = 2_000_000
  const probe = new TokenStore({ max: 4, ttlMs: 1000 })
  probe.put('boundary', { hash: 'boundary', text: 'x', kind: 'text', tokens: 1 }, T)
  const inside = probe.find('boundary', T + 999).kind === 'found'
  const outside = probe.find('boundary', T + 1001).kind === 'missing'
  return inside && outside
})())

// One malformed insert must not disable the whole store.
//
// `TokenStore` is exported, so `put` is reachable with a hand-built entry. An
// entry with no `createdAt` used to make `expire` throw on `undefined` — and
// because the bad entry stayed in the map, every later call on that store threw
// too. The failure mode is disproportionate to the mistake: one bad write
// bricks an otherwise healthy store.
check('an entry with no createdAt is accepted, not fatal', (() => {
  const probe = new TokenStore({ max: 4, ttlMs: 60_000 })
  probe.put('good', { hash: 'good', text: 'x', kind: 'text', tokens: 1, createdAt: Date.now() })
  try {
    probe.put('malformed', { text: 'no timestamp', kind: 'text' })
    return probe.find('good').kind === 'found' && probe.find('malformed').kind === 'found'
  } catch {
    return false
  }
})())
check('a non-string token is a miss, not a throw', (() => {
  const probe = new TokenStore({ max: 4, ttlMs: 60_000 })
  probe.put('real', { hash: 'real', text: 'x', kind: 'text', tokens: 1, createdAt: Date.now() })
  // `undefined` would previously reach `key.startsWith(undefined)` and throw.
  return [undefined, null, 42, {}, []].every((value) => {
    try {
      return probe.find(value).kind === 'missing'
    } catch {
      return false
    }
  })
})())
check('an empty token never resolves to an entry', (() => {
  const probe = new TokenStore({ max: 4, ttlMs: 60_000 })
  probe.put('abcdef', { hash: 'abcdef', text: 'x', kind: 'text', tokens: 1, createdAt: Date.now() })
  return probe.find('').kind === 'missing'
})())

// ── handler dispatch: the fast path must not change what is reported ────────
//
// `compress` runs the detected handler first and skips the other five when it
// already clears the savings floor. `fullScan: true` forces the unoptimised
// ordering — every handler runs, the winner is chosen from the complete set —
// which makes the two paths directly comparable on the real handlers.
//
// The optimisation is only acceptable if it is invisible, so the first job here
// is equality. The second is that it actually skips work: a "fast path" that
// silently stopped being taken would otherwise go unnoticed, since correctness
// would be unaffected.

console.log('\ndispatch')
const dispatchEngine = engineFor()

/** Everything a caller can observe from one call. */
const dispatchSignature = (content, options) => {
  const result = compress(content, { store: dispatchEngine.store, ...options })
  return ['kind', 'detected', 'confident', 'compressed', 'stored', 'originalTokens', 'compressedTokens', 'savedTokens', 'savedPercent', 'truncated']
    .map((field) => field + '=' + String(result[field]))
    .join('|')
}

const dispatchCases = [
  ['log', Array.from({ length: 300 }, (_, i) => '2026-03-14T09:00:00.000Z DEBUG hb seq=' + i).join('\n')],
  ['json', JSON.stringify({ data: Array.from({ length: 60 }, (_, i) => ({ id: 'u' + i, bio: 'b'.repeat(60) })) }, null, 2)],
  ['code', ['export class C {', ...Array.from({ length: 20 }, (_, i) => '  m' + i + '(): number {\n    let t = 0\n    for (const v of [1]) t += v\n    return t\n  }'), '}'].join('\n')],
  ['text', ['# D', ''].concat(Array.from({ length: 20 }, (_, i) => '## S' + i + '\n\n' + 'word '.repeat(90))).join('\n')],
  ['diff', ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,40 +1,40 @@'].concat(Array.from({ length: 40 }, (_, i) => '-old ' + i)).concat(Array.from({ length: 40 }, (_, i) => '+new ' + i)).join('\n')],
  ['lines', Array.from({ length: 300 }, (_, i) => '/opt/app/pkg-' + i + '   ' + (2000 + i)).join('\n')],
  ['tiny json', '{"a":1}'],
  ['uncompressed prose', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'],
  ['cjk', '团队在评审中详细讨论了这个提案。它开篇声称该变更降低了耦合。'.repeat(30)],
]

let dispatchDifferences = 0
for (const [label, content] of dispatchCases) {
  if (dispatchSignature(content) !== dispatchSignature(content, { fullScan: true })) dispatchDifferences += 1
  // Forcing every kind must agree too, so the fast path cannot change which
  // handler answers when the caller names one.
  for (const kind of ['json', 'code', 'log', 'text', 'diff', 'lines']) {
    if (dispatchSignature(content, { kind }) !== dispatchSignature(content, { kind, fullScan: true })) {
      dispatchDifferences += 1
    }
  }
}
check('the fast path reports exactly what the full scan reports', dispatchDifferences === 0,
  dispatchDifferences + ' differences across ' + dispatchCases.length + ' payloads x 7 configurations')

// The fast path must still be a fast path. Measured on a payload big enough for
// the difference to exceed scheduling noise: the skipped handlers each walk the
// whole 615 KB, so taking them costs roughly half again as much.
const bulkyProse = ['# Doc', ''].concat(
  Array.from({ length: 400 }, (_, i) => '## Section ' + i + '\n\n' + 'The team considered the proposal at length during the review. '.repeat(20) + '\n'),
).join('\n')
const timeCompress = (options) => {
  const started = performance.now()
  for (let i = 0; i < 6; i += 1) compress(bulkyProse, { store: dispatchEngine.store, ...options })
  return (performance.now() - started) / 6
}
timeCompress({}) // warm
const fastMs = timeCompress({})
const slowMs = timeCompress({ fullScan: true })
check('the fast path actually skips work', slowMs > fastMs * 1.15,
  'fast=' + fastMs.toFixed(1) + 'ms full=' + slowMs.toFixed(1) + 'ms ratio=' + (slowMs / fastMs).toFixed(2) + 'x')

// ── query search ────────────────────────────────────────────────────────────

console.log('\nretrieve with query')
const searchEngine = engineFor()
const haystack = [
  'alpha beta gamma delta',
  'nothing interesting on this line at all',
  'the needle appears right here in this sentence',
  'more filler content to pad the document out',
  'yet more filler that separates the two hits',
  'still more filler to push the regions apart',
  'another line mentioning the needle once again',
].join('\n')
searchEngine.store.put('q1', { hash: 'q1', text: haystack, kind: 'text', tokens: 40, createdAt: Date.now() })
const regions = searchEngine.search(haystack, 'needle', 20)
check('query finds matching regions', regions.length === 2, 'found ' + regions.length)
check('query returns line numbers', regions[0]?.line === 3, JSON.stringify(regions.map((region) => region.line)))
check('query result is cheaper than the original', regions.reduce((sum, region) => sum + estimateTokens(region.text), 0) < estimateTokens(haystack))

// ── stats ───────────────────────────────────────────────────────────────────

console.log('\nstats')
const statsEngine = engineFor()
const statsResult = statsEngine.compress(codeContent)
statsEngine.record({ action: 'compress', tokensBefore: statsResult.originalTokens, tokensAfter: statsResult.compressedTokens, savedTokens: statsResult.savedTokens })
statsEngine.record({ action: 'retrieve', tokensBefore: 0, tokensAfter: 10, savedTokens: 0 })
const stats = statsEngine.stats()
check('stats count compressions', stats.compressions === 1)
check('stats count retrievals', stats.retrievals === 1)
check('stats report savings', stats.tokensSaved > 0 && stats.savingsPercent > 0)
check('stats keep recent events', stats.recentEvents.length === 2)

// ── determinism ─────────────────────────────────────────────────────────────

console.log('\ndeterminism')
const first = compress(codeContent, { store: engineFor().store })
const second = compress(codeContent, { store: engineFor().store })
check('same input yields same token', first.token === second.token)
check('same input yields same text', first.compressed === second.compressed)

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)

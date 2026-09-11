/**
 * Probe the log handler's guarantees.
 *
 * The log handler makes the strongest promise in the engine: every fatal and
 * error line survives, however many there are. This checks that against every
 * shape a real log takes, because the promise is the reason a compressed log is
 * usable at all — a reader who cannot trust "the errors are all here" has to
 * read the original.
 *
 * It also checks the two other things the handler claims: that stack traces are
 * kept, and that routine repetition is thinned rather than preserved.
 *
 * Run with: node bench/probe-log-edges.mjs
 */

import { compress, getEngine, detectKind, estimateTokens } from '../lib/engine.js'

let findings = 0
const log = []
const note = (kind, name, detail) => {
  log.push(kind.padEnd(5) + name.padEnd(52) + detail)
  if (kind === 'BUG' || kind === 'FAIL') findings += 1
}

const engine = getEngine({ storeMax: 64, ttlMs: 60_000 })
const serious = (text) => (text.match(/\b(?:FATAL|CRITICAL|SEVERE|ERROR|ERR)\b/g) ?? []).length

/** Compress, assert the round trip, and report. */
function check(label, content, { expectKind = 'log' } = {}) {
  const result = compress(content, { store: engine.store, kind: 'log' })
  if (result.stored === false) {
    note('ok', label + ' (refused)', String(result.note).slice(0, 40))
    return result
  }
  const back = engine.store.find(result.token)
  if (back.kind !== 'found' || back.entry.text !== content) {
    note('BUG', label + ' round trip', 'store says ' + back.kind)
  }
  const before = serious(content)
  const after = serious(result.compressed)
  if (after < before) {
    note('BUG', label + ' lost serious lines', before + ' -> ' + after + ' at ' + result.savedPercent + '%')
  }
  return result
}

// ── the guarantee, across counts ───────────────────────────────────────────

const errorLines = (count, message = 'event') =>
  Array.from({ length: count }, (_, i) => '2026-03-14T09:00:00.000Z ERROR ' + message + ' ' + i).join('\n')

for (const count of [1, 2, 5, 16, 17, 50, 200, 1000]) {
  const content = errorLines(count)
  const result = check('ERROR x' + count, content)
  note('ok', 'ERROR x' + count, serious(content) + ' -> ' + serious(result.compressed) +
    ' serious, saved ' + result.savedPercent + '%')
}

// Up to and past the sampling threshold, where the old behaviour changed.
for (const count of [8, 16, 17, 100]) {
  for (const level of ['FATAL', 'CRITICAL', 'SEVERE']) {
    const content = Array.from({ length: count }, (_, i) => '2026-03-14T09:00:00.000Z ' + level + ' event ' + i).join('\n')
    const result = compress(content, { store: engine.store, kind: 'log' })
    if (result.stored === false) continue
    const kept = serious(result.compressed)
    if (kept < count) note('BUG', level + ' x' + count + ' lost lines', kept + ' of ' + count)
  }
}
note('ok', 'FATAL / CRITICAL / SEVERE all covered by the guarantee', 'counts 8, 16, 17, 100')

// ── mixed levels: the realistic shape ──────────────────────────────────────

const mixed = [
  ...Array.from({ length: 800 }, (_, i) => '2026-03-14T09:00:00.000Z DEBUG heartbeat seq=' + i + ' idle=' + (i % 4)),
  ...Array.from({ length: 60 }, (_, i) => '2026-03-14T09:01:00.000Z INFO step ' + i + ' completed'),
  ...Array.from({ length: 40 }, (_, i) => '2026-03-14T09:02:00.000Z WARN latency above budget p99=' + (400 + i)),
  ...Array.from({ length: 7 }, (_, i) => '2026-03-14T09:03:00.000Z ERROR request ' + i + ' failed: upstream timeout'),
  '2026-03-14T09:03:01.000Z ERROR unhandled exception in worker pool',
  '    at com.example.Pool.run(Pool.java:88)',
  '    at com.example.Main.main(Main.java:12)',
  ...Array.from({ length: 3 }, (_, i) => '2026-03-14T09:04:00.000Z FATAL giving up after retries, exiting ' + i),
].join('\n')
const mixedResult = check('realistic mixed log', mixed)
note('ok', 'mixed log', mixed.split('\n').length + ' lines -> ' + mixedResult.savedPercent + '% saved, ' +
  serious(mixed) + ' -> ' + serious(mixedResult.compressed) + ' serious')
note(
  /Pool\.java:88/.test(mixedResult.compressed) ? 'ok' : 'BUG',
  'mixed log: stack trace survives',
  /Pool\.java:88/.test(mixedResult.compressed) ? 'at com.example.Pool.run kept' : 'trace missing',
)
note(
  mixedResult.compressed.includes('<<hr:log:') ? 'ok' : 'BUG',
  'mixed log: routine lines are thinned with a marker',
  mixedResult.compressed.includes('<<hr:log:') ? 'marker present' : 'nothing thinned',
)

// ── repeated identical lines, the flood case ───────────────────────────────

for (const [label, level] of [['identical ERROR flood', 'ERROR'], ['identical WARN flood', 'WARN'], ['identical DEBUG flood', 'DEBUG']]) {
  const content = Array.from({ length: 300 }, () => '2026-03-14T09:00:00.000Z ' + level + ' downstream unavailable: connection reset').join('\n')
  const result = compress(content, { store: engine.store, kind: 'log' })
  if (result.stored === false) {
    note('ok', label + ' refused', String(result.note).slice(0, 36))
    continue
  }
  const back = engine.store.find(result.token)
  const exact = back.kind === 'found' && back.entry.text === content
  note(exact ? 'ok' : 'BUG', label, result.savedPercent + '% saved, identical=' + result.transforms.includes('log:repeats-factored'))
  if (level === 'ERROR' && result.savedPercent < 90) {
    note('BUG', label + ' was not factored', result.savedPercent + '% — the flood should collapse to one template')
  }
}

// ── near-identical lines (varying id, same message) ────────────────────────

{
  const content = Array.from({ length: 300 }, (_, i) => '2026-03-14T09:00:00.000Z ERROR request ' + i + ' failed: upstream timeout').join('\n')
  const result = compress(content, { store: engine.store, kind: 'log' })
  note('ok', 'near-identical errors (varying id)', result.savedPercent + '% saved; consecutive lines differ, so only the prefix is shared')
}

// ── log-shaped things that are not logs ────────────────────────────────────

{
  const prose = Array.from({ length: 40 }, (_, i) =>
    'The team considered the proposal at length during the review of item ' + i + '. ' +
    'It opens by claiming the change reduces coupling between the modules under discussion. ' +
    'The middle walks through supporting detail and benchmarks that a reader skimming does not need.').join('\n\n')
  const result = compress(prose, { store: engine.store })
  note(result.kind !== 'log' ? 'ok' : 'BUG', 'prose with no severity is not treated as a log', 'ran ' + result.kind)
}

{
  const body = Array.from({ length: 60 }, (_, i) => 'payload item ' + i + ' with no level marker at all, just text').join('\n')
  const result = compress(body, { store: engine.store })
  note(result.kind !== 'log' ? 'ok' : 'BUG', 'severity-free lines are not treated as a log', 'ran ' + result.kind)
}

// A single ERROR mention in otherwise ordinary text must not make it a log.
{
  const doc = '# Notes\n\n' + 'The build step failed with an ERROR code somewhere in the pipeline. '.repeat(6) + '\n\n' +
    'Everything else in this document is ordinary prose that repeats itself in the usual way. '.repeat(6)
  const result = compress(doc, { store: engine.store })
  note(result.kind !== 'log' ? 'ok' : 'BUG', 'a prose document mentioning ERROR once is not a log', 'ran ' + result.kind)
}

// ── unicode, CRLF, and a final line without a newline ──────────────────────

{
  const crlf = Array.from({ length: 200 }, (_, i) => '2026-03-14T09:00:00.000Z DEBUG line ' + i).join('\r\n') +
    '\r\n2026-03-14T09:01:00.000Z ERROR failed on windows'
  const result = compress(crlf, { store: engine.store, kind: 'log' })
  const back = engine.store.find(result.token)
  const exact = back.kind === 'found' && back.entry.text === crlf
  note(exact ? 'ok' : 'BUG', 'CRLF log round-trips byte-exact', exact ? 'exact' : 'differed')
  note(serious(result.compressed) >= 1 ? 'ok' : 'BUG', 'CRLF log keeps its error line', String(serious(result.compressed)))
}

{
  const cjk = Array.from({ length: 200 }, (_, i) => '2026-03-14T09:00:00.000Z DEBUG 心跳 序号=' + i).join('\n') +
    '\n2026-03-14T09:01:00.000Z ERROR 连接被重置'
  const result = compress(cjk, { store: engine.store, kind: 'log' })
  const back = engine.store.find(result.token)
  note(back.kind === 'found' && back.entry.text === cjk ? 'ok' : 'BUG', 'CJK log round-trips byte-exact', '')
  note(result.compressed.includes('连接被重置') ? 'ok' : 'BUG', 'CJK error line is kept', '')
}

// ── report ─────────────────────────────────────────────────────────────────

console.log(log.join('\n'))
console.log('')
console.log(findings === 0 ? 'no findings in ' + log.length + ' checks' : findings + ' finding(s) across ' + log.length + ' checks')
process.exit(findings === 0 ? 0 : 1)

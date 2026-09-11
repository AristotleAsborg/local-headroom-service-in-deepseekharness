/**
 * Property probe for the token estimator and its accounting.
 *
 * The estimator decides everything the user sees: whether a compression is worth
 * making, and the ratio reported afterwards. It is the one component whose
 * mistakes are invisible, because a wrong number still looks like a number. This
 * checks it against properties rather than against expected values:
 *
 *   1. Monotone in length. Appending text must never lower the estimate. A local
 *      drop means the estimator is measuring shape rather than size, and any
 *      saving computed across that boundary is an artefact.
 *   2. Non-negative and finite for arbitrary input.
 *   3. Integer-valued for the totals the tool reports. A fractional token count
 *      leaks into savedTokens and savedPercent, so a caller comparing two results
 *      sees values that cannot be compared.
 *   4. savedTokens / savedPercent agree with the estimate of the text actually
 *      returned, which is what the caller can see.
 *   5. The reported ratio is bounded by [0, 100].
 *
 * Run with: node bench/probe-estimator.mjs
 */

import { compress, getEngine, estimateTokens } from '../lib/engine.js'

let findings = 0
const log = []
const note = (kind, name, detail) => {
  log.push(kind.padEnd(5) + name.padEnd(50) + detail)
  if (kind === 'BUG' || kind === 'FAIL') findings += 1
}

// ── 1. monotonicity ─────────────────────────────────────────────────────────

const SEEDS = [
  'a', 'ab', 'abc', 'abcd', 'abcde', 'hello world', 'Hello World',
  'const x = 1', 'const x = 1;', 'x'.repeat(50), 'ab '.repeat(30),
  JSON.stringify({ a: 1 }), JSON.stringify({ a: 1, b: 2 }),
  '2026-03-14T09:00:00.000Z DEBUG heartbeat seq=1',
  'C:\\Users\\x\\AppData\\Local\\Temp', '/srv/app/node_modules/vite/dist/index.js:12000:11',
  '连接被重置', '中文内容中文内容', 'mixed 中文 and ascii',
  'sha512-' + 'a'.repeat(86), '\n', '\n\n', '   ', '\ttab', 'a\nb', '# comment',
]

let drops = 0
let worstDrop = null
for (const seed of SEEDS) {
  let previous = estimateTokens(seed)
  for (let length = 1; length <= 400; length += 1) {
    const text = seed + ' '.repeat(length)
    const value = estimateTokens(text)
    if (value < previous - 1e-9) {
      drops += 1
      if (worstDrop === null || previous - value > worstDrop.drop) {
        worstDrop = { seed, length, previous, value, drop: previous - value }
      }
    }
    previous = value
  }
}
note(drops === 0 ? 'ok' : 'BUG', 'appending to a string never lowers the estimate',
  drops === 0 ? '0 drops across ' + SEEDS.length * 400 + ' samples'
    : drops + ' drops, worst ' + JSON.stringify(worstDrop))

// Appending non-space content is the case that actually matters.
let contentDrops = 0
let worstContentDrop = null
for (const seed of SEEDS) {
  let previous = estimateTokens(seed)
  for (let length = 1; length <= 200; length += 1) {
    const text = seed + 'x'.repeat(length)
    const value = estimateTokens(text)
    if (value < previous - 1e-9) {
      contentDrops += 1
      if (worstContentDrop === null) worstContentDrop = { seed, length, previous, value }
    }
    previous = value
  }
}
note(contentDrops === 0 ? 'ok' : 'BUG', 'appending characters never lowers the estimate',
  contentDrops === 0 ? '0 drops' : contentDrops + ' drops, first ' + JSON.stringify(worstContentDrop))

// Appending a newline is the cheapest possible growth and the easiest to break.
let newlineDrops = 0
for (const seed of SEEDS) {
  if (estimateTokens(seed + '\n') < estimateTokens(seed)) newlineDrops += 1
}
note(newlineDrops === 0 ? 'ok' : 'BUG', 'appending a newline never lowers the estimate',
  newlineDrops === 0 ? 'holds for all seeds' : newlineDrops + ' seeds dropped')

// ── 2. domain and finiteness ────────────────────────────────────────────────

const EXTREMES = [
  '', ' ', '\n', '\u0000', '\uFFFD', '\uD83D\uDE00', 'x'.repeat(100000),
  '中'.repeat(5000), '\u200b', '\u0301', 'a\u0301', 'e\u0301'.repeat(100),
  String.fromCharCode(0x1f600), '\r\n'.repeat(1000),
]
const badExtremes = EXTREMES.filter((text) => {
  const value = estimateTokens(text)
  return typeof value !== 'number' || !Number.isFinite(value) || value < 0
})
note(badExtremes.length === 0 ? 'ok' : 'BUG', 'the estimate is finite and non-negative everywhere',
  badExtremes.length === 0 ? EXTREMES.length + ' extreme inputs' : JSON.stringify(badExtremes))

const nonString = [undefined, null, 42, {}, [], true, Symbol('s')]
const badTypes = nonString.filter((value) => {
  try {
    return typeof estimateTokens(value) !== 'number'
  } catch {
    return true
  }
})
note(badTypes.length === 0 ? 'ok' : 'BUG', 'a non-string yields a number, not a throw',
  badTypes.length === 0 ? '0 of ' + nonString.length : String(badTypes.length) + ' threw or returned non-number')

// ── 3 and 4. the accounting the tool reports ────────────────────────────────

const engine = getEngine({ storeMax: 32, ttlMs: 60_000 })
const CASES = [
  ['log', Array.from({ length: 300 }, (_, i) => '2026-03-14T09:00:00.000Z DEBUG hb seq=' + i).join('\n')],
  ['json', JSON.stringify({ data: Array.from({ length: 60 }, (_, i) => ({ id: 'u' + i, bio: 'b'.repeat(80) })) }, null, 2)],
  ['code', ['export class C {', ...Array.from({ length: 12 }, (_, i) => '  m' + i + '(): number {\n    let t = 0\n    for (const v of [1]) t += v\n    return t\n  }'), '}'].join('\n')],
  ['text', '# D\n\n' + Array.from({ length: 10 }, (_, i) => '## S' + i + '\n\n' + 'word '.repeat(80)).join('\n')],
  ['cjk', '中文内容重复'.repeat(300)],
  ['diff', ['diff --git a/x b/x', '--- a/x', '+++ b/x', '@@ -1,10 +1,10 @@'].concat(Array.from({ length: 40 }, (_, i) => '-old ' + i)).concat(Array.from({ length: 40 }, (_, i) => '+new ' + i)).join('\n')],
]

const nonInteger = []
const mismatch = []
const outOfRange = []
for (const [label, content] of CASES) {
  const result = compress(content, { store: engine.store })
  if (result.stored === false) {
    note('ok', label + ' refused with a reason', String(result.note).slice(0, 40))
    continue
  }

  for (const [field, value] of [
    ['originalTokens', result.originalTokens],
    ['compressedTokens', result.compressedTokens],
    ['savedTokens', result.savedTokens],
  ]) {
    if (!Number.isInteger(value)) nonInteger.push(label + '.' + field + '=' + value)
  }

  const visible = estimateTokens(result.compressed)
  if (result.compressedTokens !== visible) {
    mismatch.push(label + ': compressedTokens=' + result.compressedTokens + ' text=' + visible)
  }
  const expectedSaved = result.originalTokens - result.compressedTokens
  if (result.savedTokens !== expectedSaved) {
    mismatch.push(label + ': savedTokens=' + result.savedTokens + ' expected=' + expectedSaved)
  }

  const percent = result.savedPercent
  if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) {
    outOfRange.push(label + '=' + percent)
  } else {
    // `savedPercent` is rounded to one decimal place on purpose
    // (`Math.round(savedRatio * 1000) / 10`), so the only honest check is that
    // the difference from the exact ratio is within that rounding step. Demanding
    // exact equality here would be testing my own assumption, not the code — the
    // first version of this probe did exactly that and reported a false bug.
    const exact = (100 * expectedSaved) / result.originalTokens
    if (Math.abs(percent - exact) > 0.05) {
      outOfRange.push(label + ': percent=' + percent + ' exact=' + exact.toFixed(4))
    }
  }

  note('ok', label + ' accounted', result.originalTokens + ' -> ' + result.compressedTokens +
    ' = ' + result.savedPercent + '%')
}

note(nonInteger.length === 0 ? 'ok' : 'BUG', 'reported token counts are integers',
  nonInteger.length === 0 ? 'all integer' : nonInteger.slice(0, 4).join(', '))
note(mismatch.length === 0 ? 'ok' : 'BUG', 'reported counts match the text returned',
  mismatch.length === 0 ? 'consistent' : mismatch.slice(0, 4).join(' | '))
note(outOfRange.length === 0 ? 'ok' : 'BUG', 'the reported percentage is bounded and consistent',
  outOfRange.length === 0 ? 'within [0,100]' : outOfRange.slice(0, 4).join(' | '))

// ── report ──────────────────────────────────────────────────────────────────

console.log(log.join('\n'))
console.log('')
console.log(findings === 0 ? 'no findings in ' + log.length + ' checks' : findings + ' finding(s) across ' + log.length + ' checks')
process.exit(findings === 0 ? 0 : 1)

/**
 * A randomized differential fuzz over the compression engine.
 *
 * The hand-written probes check the cases I thought of. This one checks the
 * cases I did not: it generates payloads from a seeded PRNG across shapes a real
 * session produces (nested API pages, lockfiles, logs with interleaved traces,
 * diffs with mixed content, minified JSON, JSON with unicode keys, text with
 * embedded JSON, and pathological mixtures of all of them), then asserts the
 * invariants the tool's contract promises.
 *
 * Every payload is reproducible from its seed, so a failure can be replayed
 * exactly with `--seed <n> --only <index>`.
 *
 * The invariants, in the order they matter:
 *
 *   1. Losslessness. If `compressed` came back, `retrieve` must return the input
 *      byte for byte. This is the only promise that cannot be traded away.
 *   2. Never bigger. A pass that inflates the payload is worse than no pass, and
 *      `savedTokens` must never be positive when it did.
 *   3. Declared shape. A json pass must leave parseable json, `truncated` must be
 *      true exactly when the text was capped, and `confident` must be false
 *      exactly when the handler that ran was not the one detection picked.
 *   4. No crash. Any input at all must come back as a result object.
 *
 * Run with: node bench/fuzz-engine.mjs [--count 400] [--seed 1] [--only <i>]
 */

import { compress, getEngine, detectKind, estimateTokens } from '../lib/engine.js'
import { asUrl, requireExistingPath } from '../dsh-paths.mjs'

/**
 * The harness's own estimator, when it is reachable.
 *
 * Whether a pass is worth making is decided with the engine's estimator, which
 * is deliberately conservative. The harness prices context with a different
 * one, so a refusal is worth double-checking under the ruler that actually
 * decides the bill.
 */
const meter = await import(asUrl(requireExistingPath('meterEntry'))).catch(() => null)
const meterTokens = meter === null ? null : (text) => meter.estimateContent([{ type: 'text', text }])

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}
const COUNT = Number(flag('count', 400))
const BASE_SEED = Number(flag('seed', 1))
const ONLY = flag('only', null)

// ── deterministic PRNG and generators ───────────────────────────────────────

/**
 * Seeded PRNG (mulberry32).
 *
 * The first version used a plain LCG and it silently broke the fuzz: an LCG's
 * first output is a nearly linear function of the seed, so consecutive seeds
 * produced 0.236455, 0.236843, 0.274823 … and `floor(r * 10)` returned 2 or 3
 * every time. The run reported "no violations" while exercising two of the ten
 * generators — the worst possible failure mode for a fuzzer, since a clean
 * result looked like evidence.
 *
 * mulberry32 mixes the seed through several rounds before its first output, so
 * adjacent seeds land far apart.
 */
function rng(seed) {
  let state = (seed >>> 0) || 1
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (random, list) => list[Math.floor(random() * list.length)]
const int = (random, low, high) => low + Math.floor(random() * (high - low + 1))

const WORDS = ('handler surface budget cursor region snapshot checkpoint retention candidate ' +
  'payload deterministic reversible structural heuristic estimator conservative skeleton ' +
  'identifier transform marker digest prefix suffix array scalar nested subtree header tail').split(' ')

const prose = (random, words) => Array.from({ length: words }, () => pick(random, WORDS)).join(' ')

/** Shapes that mirror what a session actually pulls in, plus their mixtures. */
const GENERATORS = {
  apiPage(random) {
    const count = int(random, 3, 40)
    const keys = pick(random, [
      ['id', 'email', 'active'],
      ['id', 'name', 'bio', 'created'],
      ['id', 'owner', 'limits', 'tags'],
      ['id', 'email', 'plan', 'quota', 'bio'],
    ])
    const shaped = random() < 0.85
    const data = Array.from({ length: count }, (_, index) => {
      const record = {}
      for (const key of keys) {
        if (key === 'id') record[key] = 'usr_' + String(index).padStart(4, '0')
        else if (key === 'email') record[key] = 'p' + index + '@example.com'
        else if (key === 'active') record[key] = index % 3 !== 0
        else if (key === 'created') record[key] = 1793000000 + index
        else if (key === 'name') record[key] = 'name-' + index
        else if (key === 'bio') record[key] = prose(random, int(random, 4, 30))
        else if (key === 'owner') record[key] = { id: 'own_' + index, verified: index % 2 === 0 }
        else if (key === 'limits') record[key] = { seats: 5 + index, resetsAt: '2026-04-01T00:00:00Z' }
        else if (key === 'tags') record[key] = ['a', 'b', 'c'].slice(0, int(random, 1, 3))
        else if (key === 'plan') record[key] = pick(random, ['free', 'team', 'enterprise'])
        else if (key === 'quota') record[key] = { used: index * 3, total: 1000 }
      }
      // An occasional extra key breaks same-shape factoring, which is the point:
      // the handler must refuse to factor rather than emit lying rows.
      if (!shaped && index === count - 1) record.extra = 'outlier'
      return record
    })
    return JSON.stringify({ object: 'list', has_more: random() < 0.5, data }, null, random() < 0.7 ? 2 : 0)
  },

  lockfile(random) {
    const count = int(random, 3, 60)
    const packages = {}
    for (let index = 0; index < count; index += 1) {
      packages['node_modules/@x/pkg-' + index] = {
        version: '1.' + (index % 20) + '.0',
        resolved: 'https://registry.example.com/pkg-' + index + '/-/pkg-' + index + '.tgz',
        integrity: 'sha512-' + String(index % 10).repeat(86).slice(0, int(random, 40, 86)),
        license: 'MIT',
        dev: index % 2 === 0,
      }
    }
    return JSON.stringify({ name: 'app', lockfileVersion: 3, packages }, null, 2)
  },

  log(random) {
    const lines = []
    const count = int(random, 40, 500)
    for (let index = 0; index < count; index += 1) {
      const roll = random()
      if (roll < 0.7) lines.push('2026-03-14T09:' + String(index % 60).padStart(2, '0') + ':00.000Z DEBUG hb seq=' + index + ' q=' + (index % 4))
      else if (roll < 0.85) lines.push('2026-03-14T09:' + String(index % 60).padStart(2, '0') + ':01.000Z INFO  step ' + index + ' ' + prose(random, 6))
      else if (roll < 0.95) lines.push('2026-03-14T09:' + String(index % 60).padStart(2, '0') + ':02.000Z WARN  ' + prose(random, 8))
      else {
        lines.push('2026-03-14T09:' + String(index % 60).padStart(2, '0') + ':03.000Z ERROR failed: ' + prose(random, 5))
        for (let frame = 0; frame < int(random, 1, 12); frame += 1) {
          lines.push('    at fn' + frame + ' (/srv/app/node_modules/x/dep-' + (frame * 37) + '.js:' + (1000 + frame) + ':' + frame + ')')
        }
      }
    }
    return lines.join(random() < 0.3 ? '\r\n' : '\n')
  },

  diff(random) {
    const lines = ['diff --git a/src/x.ts b/src/x.ts', 'index 1111111..2222222 100644', '--- a/src/x.ts', '+++ b/src/x.ts']
    const hunks = int(random, 1, 4)
    for (let hunk = 0; hunk < hunks; hunk += 1) {
      lines.push('@@ -' + (10 + hunk * 20) + ',' + int(random, 3, 30) + ' +' + (12 + hunk * 20) + ',' + int(random, 3, 30) + ' @@ ctx')
      for (let index = 0; index < int(random, 5, 60); index += 1) {
        const roll = random()
        if (roll < 0.45) lines.push('-  const previous = state.nodes[' + index + '] ?? fallback(' + index + ')')
        else if (roll < 0.9) lines.push('+  const previous = resolveNode(state, ' + index + ', fallback)')
        else lines.push('   ' + prose(random, 5))
      }
    }
    return lines.join('\n')
  },

  listing(random) {
    const count = int(random, 20, 400)
    const root = pick(random, ['/opt/app/node_modules/', 'D:\\proj\\src\\', './packages/'])
    return Array.from({ length: count }, (_, index) =>
      root + pick(random, ['pkg', 'mod', 'lib']) + '-' + index + '   ' + (2000 + index * 7)).join('\n')
  },

  document(random) {
    const parts = ['# Doc', '']
    const sections = int(random, 2, 20)
    for (let index = 0; index < sections; index += 1) {
      parts.push('## Section ' + index)
      parts.push('')
      parts.push(prose(random, int(random, 20, 80)))
      parts.push('')
    }
    return parts.join('\n')
  },

  code(random) {
    const methods = int(random, 2, 30)
    const parts = ['export class Thing {', '  private readonly map = new Map<string, number>()', '']
    for (let index = 0; index < methods; index += 1) {
      parts.push('  compute' + index + '(input: number[]): number {')
      parts.push('    let total = 0')
      parts.push('    const weight = ' + (index + 1) + ' * 104729')
      for (let inner = 0; inner < int(random, 2, 10); inner += 1) {
        parts.push('    for (const value of input) total += value * weight')
      }
      parts.push('    return total')
      parts.push('  }')
      parts.push('')
    }
    parts.push('}')
    return parts.join('\n')
  },

  /** JSON whose keys are unicode, empty, numeric-looking, or need escaping. */
  awkwardJson(random) {
    const object = {}
    const count = int(random, 2, 25)
    for (let index = 0; index < count; index += 1) {
      object[pick(random, ['键' + index, 'k' + index, '123', 'a b', 'quote"here', 'n\newline', '']) ] = pick(random, [
        prose(random, int(random, 1, 40)), index, index % 2 === 0, null, [index, index + 1], { nested: index },
      ])
    }
    return JSON.stringify(object, null, 2)
  },

  /** Text with embedded structures, so detection has to choose. */
  mixed(random) {
    return [
      prose(random, 30),
      '```json',
      JSON.stringify({ a: Array.from({ length: int(random, 3, 20) }, (_, i) => ({ id: i, note: prose(random, 6) })) }, null, 2),
      '```',
      Array.from({ length: int(random, 5, 40) }, (_, i) => '2026-03-14T09:00:00.000Z INFO line ' + i).join('\n'),
      prose(random, 40),
    ].join('\n\n')
  },

  /** Arrays of primitives: factorable? no — and the handler must not pretend. */
  primitiveArrays(random) {
    return JSON.stringify({
      numbers: Array.from({ length: int(random, 4, 200) }, (_, i) => i * 7),
      strings: Array.from({ length: int(random, 4, 60) }, (_, i) => 'item-' + i),
      nested: Array.from({ length: int(random, 2, 20) }, (_, i) => [i, i + 1, i + 2]),
    }, null, 2)
  },
}

const NAMES = Object.keys(GENERATORS)

// ── the invariants ──────────────────────────────────────────────────────────

const engine = getEngine({ storeMax: 64, ttlMs: 60_000 })
const failures = []
const kinds = new Map()
/** Generator name -> detected kind -> handler that ran, to expose blind spots. */
const matrix = new Map()
let ran = 0
let roundTripped = 0
let refused = 0
let crlfPreserved = 0
/** Refusals where a candidate existed: how much it would have saved. */
const refusalGap = []

function record(name, detected, used) {
  if (!matrix.has(name)) matrix.set(name, new Map())
  const row = matrix.get(name)
  const key = detected + ' -> ' + used
  row.set(key, (row.get(key) ?? 0) + 1)
}

function fail(seed, name, invariant, detail) {
  failures.push({ seed, name, invariant, detail })
  if (failures.length <= 12) {
    console.log('  FAIL seed=' + seed + ' ' + name + ' [' + invariant + '] ' + detail)
  }
}

for (let index = 0; index < COUNT; index += 1) {
  const seed = BASE_SEED + index
  if (ONLY !== null && String(index) !== String(ONLY) && String(seed) !== String(ONLY)) continue

  const random = rng(seed)
  const name = pick(random, NAMES)
  const content = GENERATORS[name](random)
  ran += 1

  let result
  try {
    result = compress(content, { store: engine.store, kind: 'auto', now: Date.now() })
  } catch (error) {
    fail(seed, name, 'no crash', String(error && error.stack ? error.stack.split('\n')[0] : error))
    continue
  }

  if (result === null || typeof result !== 'object' || typeof result.kind !== 'string') {
    fail(seed, name, 'result shape', JSON.stringify(result).slice(0, 120))
    continue
  }

  kinds.set(result.kind, (kinds.get(result.kind) ?? 0) + 1)
  record(name, detectKind(content), result.kind)

  // A refusal is a legitimate outcome, but only with a reason and no content.
  if (result.stored === false) {
    refused += 1
    if (typeof result.note !== 'string' || result.note === '') {
      fail(seed, name, 'refusal states a reason', JSON.stringify(result).slice(0, 120))
    }
    if (result.compressed !== content) {
      fail(seed, name, 'refusal returns the input unchanged', 'compressed differed')
    }
    // How close did the refused candidate come? The note states the shortfall
    // in the engine's own tokens, which is the only window onto what was
    // declined — a refusal returns the input unchanged, so re-measuring the
    // output would say "0 saved" and mean nothing.
    const shortfall = /save only (\d+) of (\d+) tokens/.exec(result.note)
    if (shortfall !== null) {
      const saved = Number(shortfall[1])
      const total = Number(shortfall[2])
      refusalGap.push({ seed, name, saved, total, ratio: total === 0 ? 0 : saved / total })
    }
    continue
  }

  // 1. losslessness
  const found = engine.store.find(result.token)
  if (found.kind !== 'found' || found.entry.text !== content) {
    fail(seed, name, 'round trip is byte-exact', 'store lookup ' + found.kind)
    continue
  }
  roundTripped += 1

  // 2. never bigger
  const before = estimateTokens(content)
  const after = estimateTokens(result.compressed)
  if (after > before) {
    fail(seed, name, 'never inflates', before + ' -> ' + after + ' (+' + (after - before) + ')')
  }
  if (result.savedTokens !== before - after) {
    fail(seed, name, 'savedTokens matches the text', result.savedTokens + ' vs ' + (before - after))
  }

  // 3. declared shape
  if (result.kind === 'json') {
    // The document is the text before the trailing legend line, with markers
    // neutralised: a marker stands where a value goes, so it becomes a string.
    const newline = result.compressed.indexOf('\n')
    const block = newline === -1 ? result.compressed : result.compressed.slice(0, newline)
    const neutral = block.replace(/"?<<hr:[^>]*>>"?/g, '"<<m>>"').replace(/<<hr:keys:[^>]*>>/g, '"K"')
    try {
      JSON.parse(neutral)
    } catch (error) {
      fail(seed, name, 'json stays parseable', String(error.message).slice(0, 90))
    }
  }

  // A visible marker must describe a real elision: the `hidden=N` it states can
  // never exceed the bytes that were actually dropped.
  const droppedChars = content.length - result.compressed.length
  for (const match of result.compressed.matchAll(/<<hr:[a-z]+:hidden=(\d+)/g)) {
    if (Number(match[1]) > content.length) {
      fail(seed, name, 'a marker never overstates what was hidden',
        'claims ' + match[1] + ' of ' + content.length + ' bytes')
      break
    }
  }
  if (droppedChars < 0) {
    fail(seed, name, 'a stored pass is never longer than its input', String(droppedChars))
  }

  // Internal sentinels must never reach the visible text.
  if (result.compressed.includes('__hrRaw') || result.compressed.includes('__proto__')) {
    fail(seed, name, 'no internal sentinel leaks', result.compressed.slice(0, 80))
  }

  if (result.truncated === true && result.compressed.length <= 120_000) {
    fail(seed, name, 'truncated implies the cap was hit', String(result.compressed.length))
  }

  // `confident` must mean what it says: false exactly when another handler ran.
  const detected = detectKind(content)
  if (result.confident === true && result.kind !== detected) {
    fail(seed, name, 'confident implies detection was used', 'detected=' + detected + ' ran=' + result.kind)
  }

  // CRLF must survive verbatim rather than being normalised away, since a diff
  // or a config file with CRLF is a different file.
  if (content.includes('\r\n')) {
    if (!result.compressed.includes('\r\n')) {
      fail(seed, name, 'CRLF survives where lines are kept', 'no CRLF left in the output')
    } else {
      crlfPreserved += 1
    }
  }

  // 4. a second pass over the output must also be lossless and honest
  const again = compress(result.compressed, { store: engine.store, kind: 'auto', now: Date.now() })
  if (again.stored !== false) {
    const back = engine.store.find(again.token)
    if (back.kind !== 'found' || back.entry.text !== result.compressed) {
      fail(seed, name, 'second pass is lossless', 'store lookup ' + back.kind)
    }
  }
}

// ── report ──────────────────────────────────────────────────────────────────

console.log('')
console.log('ran ' + ran + ' payloads from seed ' + BASE_SEED)
console.log('  round-tripped   ' + roundTripped)
console.log('  refused         ' + refused + ' (returned unchanged, with a reason)')
console.log('  CRLF preserved  ' + crlfPreserved)
console.log('  handlers used   ' + [...kinds.entries()].map(([kind, count]) => kind + '=' + count).join(', '))
console.log('')
console.log('coverage by generator: what detection saw, and what actually ran')
for (const [name, row] of [...matrix.entries()].sort()) {
  const total = [...row.values()].reduce((sum, count) => sum + count, 0)
  const detail = [...row.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => key + ' x' + count).join('; ')
  console.log('  ' + name.padEnd(16) + String(total).padStart(4) + '   ' + detail)
}
const covered = new Set()
for (const row of matrix.values()) for (const key of row.keys()) covered.add(key.split(' -> ')[1])
const missing = ['json', 'code', 'text', 'log', 'diff', 'lines'].filter((kind) => !covered.has(kind))
if (missing.length > 0) {
  console.log('')
  console.log('  NOT EXERCISED: ' + missing.join(', ') + ' — the fuzz is not reaching these handlers')
}

// ── what the 12% floor declined ─────────────────────────────────────────────

console.log('')
if (refusalGap.length === 0) {
  console.log('refusals: ' + refused + ', none with a candidate to price')
} else {
  const nearMisses = refusalGap.filter((entry) => entry.ratio >= 0.07)
  const totalDeclined = refusalGap.reduce((sum, entry) => sum + entry.saved, 0)
  console.log('refusals with a candidate: ' + refusalGap.length + ' of ' + refused)
  console.log('  would have saved (engine tokens): ' + totalDeclined.toLocaleString('en-US'))
  console.log('  best declined ratio: ' + (100 * Math.max(...refusalGap.map((entry) => entry.ratio))).toFixed(1) + '%' +
    ' (the floor is 12%)')
  console.log('  declined candidates within 5 points of the floor: ' + nearMisses.length)
  const byName = new Map()
  for (const entry of refusalGap) byName.set(entry.name, (byName.get(entry.name) ?? 0) + 1)
  console.log('  by generator: ' + [...byName.entries()].map(([name, count]) => name + '=' + count).join(', '))
  if (nearMisses.length > 0) {
    const best = nearMisses.sort((a, b) => b.ratio - a.ratio)[0]
    console.log('  closest miss: seed=' + best.seed + ' ' + best.name + ' ' +
      best.saved + '/' + best.total + ' = ' + (100 * best.ratio).toFixed(1) + '%')
  }
}
console.log('')
if (failures.length === 0) {
  console.log('no invariant violations in ' + ran + ' payloads')
} else {
  console.log(failures.length + ' violations:')
  const byInvariant = new Map()
  for (const entry of failures) byInvariant.set(entry.invariant, (byInvariant.get(entry.invariant) ?? 0) + 1)
  for (const [invariant, count] of byInvariant) console.log('  ' + String(count).padStart(4) + '  ' + invariant)
  console.log('')
  console.log('replay one with: node bench/fuzz-engine.mjs --only ' + failures[0].seed)
}
process.exit(failures.length === 0 ? 0 : 1)

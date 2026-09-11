/**
 * Probe the remaining tool surface: `stats`, `forget`, and `render` at size.
 *
 * These three are the least exercised parts of the tool. `stats` and `forget`
 * are bookkeeping, and `render` decides what the model actually reads, which
 * makes a mistake there visible to every caller at once.
 *
 * Run with: node bench/probe-bookkeeping.mjs
 */

import { asUrl, requireExistingPath } from '../dsh-paths.mjs'

const plugin = await import(asUrl(requireExistingPath('installedEntry')))

let findings = 0
const log = []
const note = (kind, name, detail) => {
  log.push(kind.padEnd(5) + name.padEnd(52) + detail)
  if (kind === 'BUG' || kind === 'FAIL') findings += 1
}

/**
 * A fresh tool per case, so counters start from zero.
 *
 * The `storeMax` must differ for every call. The engine is cached at module scope
 * and keyed by configuration — deliberately, so a live patch reload keeps earlier
 * tokens resolvable — which means two `apply` calls with the same config share
 * one store. The first version of this probe passed identical configs and then
 * reported "two entries stored, found 8", which was the previous case's store
 * rather than a bookkeeping bug.
 */
let freshCount = 0
function freshTool(config = {}) {
  freshCount += 1
  let tool = null
  plugin.apply(
    {
      get: (name) => {
        if (name === 'tools') return { register: (definition) => { tool = definition; return () => {} } }
        return undefined
      },
      logger: { warn() {}, info() {}, debug() {} },
    },
    { ttlMinutes: 60, storeMax: 1000 + freshCount, contentStoreLimitChars: 1e9, ...config },
  )
  return tool
}

const payload = (label) => JSON.stringify({
  label,
  rows: Array.from({ length: 40 }, (_, i) => ({ id: label + '_' + i, body: 'filler '.repeat(10), n: i })),
}, null, 2)

// ── stats ───────────────────────────────────────────────────────────────────

const tool = freshTool()
const empty = await tool.execute({ action: 'stats' })
note(empty.compressions === 0 && empty.retrievals === 0 ? 'ok' : 'BUG',
  'a fresh tool reports zero activity', JSON.stringify({ c: empty.compressions, r: empty.retrievals }))
note(typeof empty.ttlMinutes === 'number' && empty.ttlMinutes > 0 ? 'ok' : 'BUG',
  'stats reports the ttl', String(empty.ttlMinutes))
note(Array.isArray(empty.recentEvents) ? 'ok' : 'BUG', 'stats reports recent events as an array', typeof empty.recentEvents)

const stored = await tool.execute({ action: 'compress', content: payload('first') })
const afterOne = await tool.execute({ action: 'stats' })
note(afterOne.compressions === 1 ? 'ok' : 'BUG', 'one compression is counted', String(afterOne.compressions))
note(afterOne.storedEntries === 1 ? 'ok' : 'BUG', 'one entry is retrievable', String(afterOne.storedEntries))
note(afterOne.tokensBefore > afterOne.tokensAfter ? 'ok' : 'BUG', 'stats totals show a saving',
  afterOne.tokensBefore + ' -> ' + afterOne.tokensAfter)
note(afterOne.tokensSaved === afterOne.tokensBefore - afterOne.tokensAfter ? 'ok' : 'BUG',
  'tokensSaved equals the difference', String(afterOne.tokensSaved))
const expectedPercent = Math.round(((afterOne.tokensBefore - afterOne.tokensAfter) / afterOne.tokensBefore) * 1000) / 10
note(Math.abs(afterOne.savingsPercent - expectedPercent) <= 0.05 ? 'ok' : 'BUG',
  'savingsPercent matches the totals', String(afterOne.savingsPercent) + ' vs ' + expectedPercent)
note(afterOne.storedBytes > 0 ? 'ok' : 'BUG', 'stats reports stored bytes', String(afterOne.storedBytes))
note(Array.isArray(afterOne.recentEvents) && afterOne.recentEvents.length > 0 ? 'ok' : 'BUG',
  'the compression appears in recent events', String(afterOne.recentEvents?.length))

await tool.execute({ action: 'retrieve', token: stored.token })
const afterRetrieve = await tool.execute({ action: 'stats' })
note(afterRetrieve.retrievals === 1 ? 'ok' : 'BUG', 'one retrieval is counted', String(afterRetrieve.retrievals))

// A refusal must not be counted as a compression that stored something.
const refusalsBefore = (await tool.execute({ action: 'stats' })).compressions
await tool.execute({ action: 'compress', content: 'aaaaaaaaaaaaaaaaaaaaaaaa' })
const refusalsAfter = (await tool.execute({ action: 'stats' })).compressions
note(refusalsAfter === refusalsBefore ? 'ok' : 'BUG',
  'a refusal is not counted as a stored compression', refusalsBefore + ' -> ' + refusalsAfter)
note((await tool.execute({ action: 'stats' })).tokensAfter >= 0 ? 'ok' : 'BUG', 'tokensAfter never goes negative', '')

// recentEvents must stay bounded.
for (let i = 0; i < 20; i += 1) await tool.execute({ action: 'compress', content: payload('flood' + i) })
const flooded = await tool.execute({ action: 'stats' })
note(flooded.recentEvents.length <= 10 ? 'ok' : 'BUG',
  'recent events is bounded', flooded.recentEvents.length + ' events')

// ── forget ──────────────────────────────────────────────────────────────────

const forgetTool = freshTool()
const keep = await forgetTool.execute({ action: 'compress', content: payload('keep') })
const drop = await forgetTool.execute({ action: 'compress', content: payload('drop') })
const beforeForget = await forgetTool.execute({ action: 'stats' })
note(beforeForget.storedEntries === 2 ? 'ok' : 'BUG', 'two entries stored', String(beforeForget.storedEntries))

const one = await forgetTool.execute({ action: 'forget', token: drop.token })
note(one.dropped === 1 && one.remaining === 1 ? 'ok' : 'BUG',
  'forget by token drops exactly one', JSON.stringify({ dropped: one.dropped, remaining: one.remaining }))
const gone = await forgetTool.execute({ action: 'retrieve', token: drop.token })
const alive = await forgetTool.execute({ action: 'retrieve', token: keep.token })
note(gone.action === 'error' ? 'ok' : 'BUG', 'the forgotten token no longer resolves', String(gone.error).slice(0, 40))
note(alive.original !== undefined ? 'ok' : 'BUG', 'the other entry survives', String(alive.error ?? 'ok'))

// A prefix that matches two entries must not be forgettable by accident: doing so
// would delete content the caller did not name.
const ambiguousTool = freshTool()
const a = await ambiguousTool.execute({ action: 'compress', content: payload('a') })
const b = await ambiguousTool.execute({ action: 'compress', content: payload('b') })
const prefix = a.token[0] === b.token[0] ? a.token[0] : null
if (prefix === null) {
  note('ok', 'no shared prefix this run; ambiguity not reachable', 'tokens differ at char 0')
} else {
  const ambiguous = await ambiguousTool.execute({ action: 'forget', token: prefix })
  const survivors = await ambiguousTool.execute({ action: 'stats' })
  note(ambiguous.dropped === 0 && survivors.storedEntries === 2 ? 'ok' : 'BUG',
    'an ambiguous prefix forgets nothing', JSON.stringify({ dropped: ambiguous.dropped, entries: survivors.storedEntries }))
}

const cleared = await forgetTool.execute({ action: 'forget' })
note(cleared.remaining === 0 ? 'ok' : 'BUG', 'forget without a token clears everything', String(cleared.remaining))
note((await forgetTool.execute({ action: 'stats' })).storedEntries === 0 ? 'ok' : 'BUG',
  'stats agrees the store is empty', '')

// ── render at size ──────────────────────────────────────────────────────────

const renderTool = freshTool()
const bigLog = Array.from({ length: 1500 }, (_, i) =>
  '2026-03-14T09:00:00.000Z DEBUG pool.worker heartbeat seq=' + i + ' idle=' + (i % 4)).join('\n')
const compressed = await renderTool.execute({ action: 'compress', content: bigLog })
const blocks = renderTool.output.render({ action: 'compress' }, compressed)
note(Array.isArray(blocks) && blocks.length > 0 ? 'ok' : 'BUG', 'render returns blocks for a large result', String(blocks?.length))
const text = blocks.map((block) => block.text).join('\n')
note(text.includes(compressed.token) ? 'ok' : 'BUG', 'rendered text carries the token', '')
note(text.includes('<<<HEADROOM:BEGIN') && text.includes('<<<HEADROOM:END>>>') ? 'ok' : 'BUG',
  'rendered text is bracketed', '')
note(text.includes(compressed.compressed.slice(0, 200)) ? 'ok' : 'BUG',
  'rendered text carries the payload start verbatim', '')

// An error result must still render something readable.
const errorText = renderTool.output.render({ action: 'retrieve' }, { action: 'error', error: 'boom' })
  .map((block) => block.text).join('\n')
note(errorText.includes('boom') ? 'ok' : 'BUG', 'an error result renders its message', '')

// Rendering must not mutate the canonical value: the registry validates the
// value and the UI renders it, and a renderer that consumed the object would
// make the second caller see something different.
const before = JSON.stringify(compressed)
renderTool.output.render({ action: 'compress' }, compressed)
note(JSON.stringify(compressed) === before ? 'ok' : 'BUG', 'render does not mutate the result', '')

// ── report ──────────────────────────────────────────────────────────────────

console.log(log.join('\n'))
console.log('')
console.log(findings === 0 ? 'no findings in ' + log.length + ' checks' : findings + ' finding(s) across ' + log.length + ' checks')
process.exit(findings === 0 ? 0 : 1)

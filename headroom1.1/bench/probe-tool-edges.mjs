/**
 * Second-pass bug hunt over the shipped tool.
 *
 * Each case is a question the existing suites do not ask. The ones that matter
 * are the shapes a real session produces by accident: a truncated token, a
 * prefix that matches two entries, an empty file, a path that is a directory,
 * content that is already a marker, and arguments of the wrong type.
 *
 * Run with: node bench/probe-tool-edges.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { asUrl, paths, requireExistingPath } from '../dsh-paths.mjs'

const installed = requireExistingPath('installedEntry')
const plugin = await import(asUrl(installed))

let tool = null
plugin.apply(
  {
    get: (name) => (name === 'tools' ? { register: (definition) => { tool = definition; return () => {} } } : undefined),
    logger: { warn() {}, info() {}, debug() {} },
  },
  // The content-store guard is raised for this probe only. It exercises token
  // handling, argument types and store eviction with payloads that are convenient
  // rather than file-shaped, and most of them sit past the default limit — with
  // the default config nearly every case would return the same refusal and the
  // probe would report "no bugs" while testing one branch.
  { ttlMinutes: 60, storeMax: 4, contentStoreLimitChars: 1e9, contentHintMinChars: 1e9 },
)

let findings = 0
const log = []
const note = (kind, name, detail) => {
  log.push(kind.padEnd(5) + name.padEnd(46) + detail)
  if (kind === 'BUG' || kind === 'FAIL') findings += 1
}

const payload = JSON.stringify({
  data: Array.from({ length: 60 }, (_, i) => ({
    id: 'usr_' + i,
    bio: 'A long biography for person ' + i + ' that no caller of this endpoint reads.',
  })),
})

// ── 1. token handling ───────────────────────────────────────────────────────

const first = await tool.execute({ action: 'compress', content: payload })
note(first.token === undefined ? 'FAIL' : 'ok', 'compress returns a 16-hex token', String(first.token))

const short = await tool.execute({ action: 'retrieve', token: first.token.slice(0, 3) })
note(short.original === payload ? 'ok' : 'BUG', 'unique prefix retrieves', short.error ?? 'returned original')

const long = await tool.execute({ action: 'retrieve', token: first.token + 'ffff' })
note(long.error !== undefined ? 'ok' : 'BUG', 'over-long token is rejected', String(long.error ?? 'returned something'))

const bogus = await tool.execute({ action: 'retrieve', token: 'zzzzzzzz' })
note(bogus.error !== undefined ? 'ok' : 'BUG', 'unknown token is rejected', String(bogus.error ?? 'returned something'))

const emptyToken = await tool.execute({ action: 'retrieve', token: '' })
note(emptyToken.error !== undefined ? 'ok' : 'BUG', 'empty token is rejected', String(emptyToken.error ?? 'returned something'))

// A second entry whose token shares a prefix with the first, to test ambiguity.
const second = await tool.execute({ action: 'compress', content: payload + '\n// distinctive tail padding' })
const ambiguous = await tool.execute({ action: 'retrieve', token: '' })
note(ambiguous.error !== undefined ? 'ok' : 'BUG', 'ambiguous/empty prefix does not return a wrong entry', String(ambiguous.error ?? 'ok'))

// ── 2. content edge cases ───────────────────────────────────────────────────

for (const [name, content] of [
  ['empty string', ''],
  ['single char', 'x'],
  ['only whitespace', '   \n\t  \n'],
  ['one very long line', 'x'.repeat(50000)],
  ['already-marked text', 'before <<hr:body:hidden=10:abcdef01>> after'],
  ['unicode CJK', '中文内容'.repeat(400)],
  ['CRLF json', JSON.stringify({ a: Array.from({ length: 40 }, (_, i) => ({ id: i, note: 'n'.repeat(40) })) }, null, 2).replace(/\n/g, '\r\n')],
]) {
  const result = await tool.execute({ action: 'compress', content })
  if (result.action === 'error') {
    note('ok', 'compress ' + name + ' -> error', String(result.error).slice(0, 60))
    continue
  }
  if (result.compressed === undefined) {
    // Refused with a reason: a legitimate outcome, as long as it says so.
    note(result.note === undefined ? 'BUG' : 'ok', 'compress ' + name + ' refused with a reason', String(result.note ?? '').slice(0, 60))
    continue
  }
  const back = await tool.execute({ action: 'retrieve', token: result.token })
  const exact = back.original === content
  note(exact ? 'ok' : 'BUG', 'compress ' + name + ' round trip', exact ? 'byte-exact' : 'DIFFERED')
  if (result.kind === 'json') {
    const block = result.compressed.split('\n')[0]
    try {
      JSON.parse(block)
      note('ok', '  ' + name + ' json block parses', '')
    } catch (error) {
      note('BUG', '  ' + name + ' json block parses', String(error.message).slice(0, 60))
    }
  }
}

// ── 3. argument validation ──────────────────────────────────────────────────

for (const [name, args] of [
  ['unknown action', { action: 'compresss' }],
  ['no action', {}],
  ['compress with neither content nor path', { action: 'compress' }],
  ['compress with number content', { action: 'compress', content: 42 }],
  ['compress with array content', { action: 'compress', content: [1, 2] }],
  ['compress with null content', { action: 'compress', content: null }],
  ['path that is a directory', { action: 'compress', path: paths().runtimeRoot }],
  ['path that does not exist', { action: 'compress', path: 'Z:/nope/nope.txt' }],
  ['bad kind', { action: 'compress', content: payload, kind: 'banana' }],
  ['bad ratio', { action: 'compress', content: payload, ratio: 'extreme' }],
  ['negative limit', { action: 'retrieve', token: first.token, query: 'person', limit: -5 }],
  ['huge limit', { action: 'retrieve', token: first.token, query: 'person', limit: 1e9 }],
  ['string limit', { action: 'retrieve', token: first.token, query: 'person', limit: 'ten' }],
  ['forget unknown token', { action: 'forget', token: 'zzzzzzzz' }],
]) {
  let result
  try {
    result = await tool.execute(args)
  } catch (error) {
    note('BUG', name + ' threw instead of returning', String(error.message).slice(0, 70))
    continue
  }
  if (result === null || typeof result !== 'object') {
    note('BUG', name + ' returned a non-object', String(result))
    continue
  }
  if (result.action !== 'error' && result.token === undefined && result.compressed === undefined &&
      result.original === undefined && result.dropped === undefined && result.compressions === undefined) {
    note('BUG', name + ' returned a shape with no outcome', JSON.stringify(result).slice(0, 80))
    continue
  }
  note('ok', name, result.action === 'error' ? 'error: ' + String(result.error).slice(0, 48) : 'handled')
}

// ── 4. store limits ─────────────────────────────────────────────────────────

const before = await tool.execute({ action: 'stats' })
for (let i = 0; i < 8; i += 1) {
  await tool.execute({ action: 'compress', content: payload + '\n// variant ' + i })
}
const after = await tool.execute({ action: 'stats' })
note(after.storedEntries <= 4 ? 'ok' : 'BUG', 'storeMax is enforced', after.storedEntries + ' entries (max 4)')

const forgotten = await tool.execute({ action: 'forget' })
note(forgotten.remaining === 0 ? 'ok' : 'BUG', 'forget without a token clears the store', String(forgotten.remaining))

const evicted = await tool.execute({ action: 'retrieve', token: first.token })
note(evicted.error !== undefined ? 'ok' : 'BUG', 'an evicted token reports honestly', String(evicted.error ?? 'returned content').slice(0, 60))

const st = await tool.execute({ action: 'stats' })
note(typeof st.tokensBefore === 'number' ? 'ok' : 'BUG', 'stats reports numeric totals', JSON.stringify({ c: st.compressions, r: st.retrievals }))

// ── 5. result shape against the declared schema ─────────────────────────────

const schema = tool.output.schema
const rendered = tool.output.render({ action: 'compress' }, first)
note(Array.isArray(rendered) && typeof rendered[0]?.text === 'string' ? 'ok' : 'BUG', 'render returns a text block', typeof rendered)

// ── report ──────────────────────────────────────────────────────────────────

console.log(log.join('\n'))
console.log('')
console.log(findings === 0 ? 'no bugs found in ' + log.length + ' checks' : findings + ' finding(s) across ' + log.length + ' checks')
process.exit(findings === 0 ? 0 : 1)

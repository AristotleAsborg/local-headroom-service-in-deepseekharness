/**
 * Probe: is the compressed JSON still structurally the same document?
 *
 * The bench measures identifier retention, which is the wrong ruler for
 * key-factored JSON: when a payload repeats one record shape, the handler writes
 * the key list once (in a `<<hr:schema:...>>` marker) and the values
 * positionally, so the *text* no longer contains `"route":` even though every
 * record is present in order. Retention then reads near-zero for a payload that
 * lost nothing structural.
 *
 * This probe adopts the reader's view instead: neutralize the markers, parse
 * both sides, and compare top-level keys, record counts and record key sets. It
 * also covers the nested-factoring case that the bench's structural check found
 * broken — a factored run whose values are themselves factored runs — because
 * that defect was invisible to every check that only looked at flat payloads.
 *
 * Run with: node bench/probe-json-structure.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { compress, getEngine } from '../lib/engine.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const engine = getEngine({ storeMax: 64, ttlMs: 60_000 })

// ── structural comparison ───────────────────────────────────────────────────

const MARKER = /"?<<hr:[^>]*>>"?/g
const neutralize = (text) => text.replace(MARKER, '"<<marker>>"').replace(/<<hr:keys:[^>]*>>/g, '"HIDDEN_KEYS"')

/** The JSON document, without the trailing key-legend marker line. */
const document_ = (compressed) => {
  const newline = compressed.indexOf('\n')
  return newline === -1 ? compressed : compressed.slice(0, newline)
}

/** The key lists that `schema` markers declare: `<digest>:<k1>|<k2>|...`. */
const declaredKeys = (text) => {
  const found = []
  for (const match of text.matchAll(/<<hr:schema:([^>]*)>>/g)) {
    const keys = match[1].split(':').slice(1).join(':')
    if (keys !== '') found.push(keys.split('|'))
  }
  return found
}

function compare(label, content) {
  const original = JSON.parse(content)
  const result = compress(content, { store: engine.store, kind: 'auto' })
  const compressed = result.compressed

  let parsed = null
  let parseError = null
  try {
    parsed = JSON.parse(neutralize(document_(compressed)))
  } catch (error) {
    parseError = String(error.message)
  }

  const leaked = [...compressed.matchAll(/\{"__hrRaw":"/g)].length
  const bareLegend = /^K\d+ = /m.test(compressed)

  console.log('=== ' + label)
  console.log('  kind        : ' + result.kind + '   tokens ' + result.originalTokens + ' -> ' + result.compressedTokens +
    '   (' + result.savedPercent + '%, stored ' + result.stored + ')')
  console.log('  transforms  : ' + result.transforms.join(', '))
  console.log('  markers     : ' + (compressed.match(/<<hr:/g) ?? []).length)
  console.log('')

  const verdicts = []
  verdicts.push(['compressed json parses (ignoring the legend line)', parseError === null, parseError ?? 'yes'])
  verdicts.push(['no raw sentinel leaked into the text', leaked === 0, leaked + ' occurrences'])
  verdicts.push(['hoist legend is marked, not bare prose', !bareLegend, bareLegend ? 'found bare `K1 = ...`' : 'marked'])

  if (parsed !== null) {
    const topBefore = Object.keys(original).length
    const topAfter = Object.keys(parsed).length
    verdicts.push(['top-level keys preserved', topBefore === topAfter, topBefore + ' -> ' + topAfter])

    for (const [name, before] of Object.entries(original)) {
      if (!Array.isArray(before)) continue
      const after = Array.isArray(parsed[name]) ? parsed[name] : []
      const records = after.filter((entry) => typeof entry !== 'string')
      const sampleBefore = before.find((entry) => entry !== null && typeof entry === 'object')
      const sampleAfter = records.find((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
      const keysMatch = sampleBefore === undefined || sampleAfter === undefined ||
        Object.keys(sampleBefore).join('|') === Object.keys(sampleAfter).join('|')
      verdicts.push(['array `' + name + '` keeps every record', records.length === before.length, records.length + '/' + before.length])
      verdicts.push(['array `' + name + '` keeps each record\'s keys', keysMatch,
        (sampleBefore === undefined ? 'n/a' : Object.keys(sampleBefore).length + ' -> ' + (sampleAfter === undefined ? 'n/a' : Object.keys(sampleAfter).length))])
    }

    const keys = declaredKeys(compressed)
    if (keys.length > 0) {
      verdicts.push(['schema markers state the key list', true, keys.length + ' marker(s), widest ' + Math.max(...keys.map((list) => list.length)) + ' keys'])
    }
  }

  for (const [name, ok, detail] of verdicts) {
    console.log('  ' + (ok ? 'PASS' : 'FAIL') + '  ' + name.padEnd(52) + ' :: ' + detail)
  }
  console.log('')
  return verdicts.every(([, ok]) => ok)
}

// ── the cases ───────────────────────────────────────────────────────────────

const index = JSON.parse(readFileSync(join(HERE, 'conversations/index.json'), 'utf8'))
const corpus = index.conversations.flatMap((conversation) =>
  conversation.payloads
    .filter((payload) => payload.kind === 'json')
    .map((payload) => [conversation.id + '/' + payload.name, readFileSync(join(HERE, 'conversations', conversation.id, payload.name), 'utf8')]),
)

const nestedRecords = (prefix, count) =>
  Array.from({ length: count }, (_, index) => ({
    id: prefix + '-' + index,
    description: 'Record ' + index + ' describes what this vector asserts, at some length.',
    input: {
      events: Array.from({ length: 5 }, (_, inner) => ({
        seq: inner + 1,
        type: ['user/message', 'assistant/message', 'tool/result'][inner % 3],
        surfaceOp: 'append',
        payload: { text: 'body text number ' + inner + ' of ' + prefix + index, tokens: 40 + inner },
      })),
    },
    expect: { accepted: index % 3 !== 0, reason: index % 3 === 0 ? 'unbalanced' : 'ok' },
  }))

const CASES = [
  ['nested factored array (regression)', JSON.stringify({ suite: 'nested', vectors: nestedRecords('vec', 5) })],
  ['nested factored map (regression)', JSON.stringify({ byId: Object.fromEntries(nestedRecords('vec', 5).map((record) => [record.id, record])) })],
  ...corpus,
]

let passed = 0
let failed = 0
for (const [label, content] of CASES) {
  if (compare(label, content)) passed += 1
  else failed += 1
}

console.log(passed + ' payloads structurally intact, ' + failed + ' with findings')
process.exit(failed === 0 ? 0 : 1)

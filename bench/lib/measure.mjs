/**
 * Shared measurement for the conversation benches.
 *
 * `conversations-bench.mjs` measures one ratio in full detail; `ratio-sweep.mjs`
 * measures all three with the same code, so the numbers in the sweep and the
 * numbers in the report can never drift apart through being computed twice.
 *
 * Everything here drives the INSTALLED plugin through its own `execute`, not the
 * engine directly: refusals, caps and the argument contract only exist on that
 * path, and measuring the engine would report a ratio for an artifact the model
 * never calls.
 */

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { asUrl, paths, requireExistingPath } from '../../dsh-paths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export const CONVERSATIONS = join(HERE, '..', 'conversations')

/**
 * The installed tool, located through `dsh-paths.mjs` rather than a literal.
 *
 * Measuring the installed artifact is the point: the engine could behave
 * differently from the copy the harness loads, and a ratio quoted for a file
 * nobody runs is not a measurement. The resolver also makes that path
 * overridable, so the same benchmark can be pointed at a second deployment.
 */
export const INSTALLED = paths().installedEntry

const meter = await import(asUrl(requireExistingPath('meterEntry')))
/** The harness's own pricing for a string, through a text block. */
export const meterTokens = (text) => meter.estimateContent([{ type: 'text', text }])

/**
 * A minimal `fs` service, so the benchmarks can drive the tool the way a real
 * session should: by `path`.
 *
 * This is not decoration. The tool refuses a `content` payload past
 * CONTENT_STORE_LIMIT_CHARS, because content that big arrived with a copy
 * already in the conversation and storing it would duplicate rather than
 * replace. The generated conversations are full of payloads past that limit, so
 * measuring them through `content` would measure the refusal instead of the
 * compression — and would also measure a usage pattern the tool exists to
 * discourage.
 *
 * `readText` receives the FsTarget that `resolve` returned, not the original
 * path string. Getting that wrong makes every lookup miss, which lands as
 * "everything refused" and looks like a compression failure.
 */
function virtualFilesystem() {
  const files = new Map()
  const target = (path) => ({ targetKey: 'bench:' + path, displayPath: String(path) })
  return {
    files,
    service: {
      resolve: async (path) => (files.has(String(path)) ? target(path) : undefined),
      readText: async (resolved) => files.get(String(resolved?.displayPath)),
      stat: async (resolved) => {
        const text = files.get(String(resolved?.displayPath))
        return text === undefined ? undefined : { type: 'file', size: text.length }
      },
    },
  }
}

/** The virtual filesystem the loaded tool reads from, when one is in use. */
const virtual = virtualFilesystem()

/**
 * Load the shipped headroom tool.
 *
 * @param options.config - extra row config, merged over the defaults.
 * @returns the registered tool definition.
 */
export async function loadTool({ config = {} } = {}) {
  if (!existsSync(INSTALLED)) {
    throw new Error('headroom is not installed at ' + INSTALLED)
  }
  const plugin = await import(asUrl(INSTALLED))
  let tool = null
  plugin.apply(
    {
      get: (name) => {
        if (name === 'tools') return { register: (definition) => { tool = definition; return () => {} } }
        if (name === 'fs') return virtual.service
        return undefined
      },
      logger: {},
    },
    { ttlMinutes: 60, storeMax: 256, ...config },
  )
  if (tool === null) throw new Error('the installed module registered no tool')
  return tool
}

/**
 * Compress one payload the way a session should, and report which mode ran.
 *
 * Always through `path`, never `content`. Four of five fixtures are past the
 * content limit, so a `content` call would be refused before the engine ran, and
 * the measurement would describe the refusal instead of the compression. `path`
 * is also the mode the tool exists to encourage.
 */
export async function compressPayload(tool, { content, label, ratio = 'balanced' }) {
  const path = 'bench-virtual/' + String(label).replace(/[\\/]/g, '_')
  virtual.files.set(path, content)
  const result = await tool.execute({ action: 'compress', path, ratio })
  return { result, path }
}

export const readIndex = () => JSON.parse(readFileSync(join(CONVERSATIONS, 'index.json'), 'utf8'))

// ── retention and structure ─────────────────────────────────────────────────

/**
 * Identifiers a reader would look up: record ids, hashes, addresses, paths,
 * numeric coordinates. Pure version strings and bare decimals name nothing that
 * can be looked up, so they are excluded.
 *
 * `uniq` counts each identifier once (is this record still nameable anywhere?);
 * `occ` counts occurrences (how much of the evidence is still on screen?). A
 * listing that keeps one path out of 400 scores 100% uniquely and 0.25% by
 * occurrence — only the second number is honest about what sampling gave up.
 * Neither is the right ruler for key-factored JSON, which is measured
 * structurally by `jsonShape` instead.
 */
const IDENTIFIER = /[A-Za-z][A-Za-z0-9_./-]*[0-9]{2,}[A-Za-z0-9_./-]*/g
export const identifierList = (text) =>
  [...text.matchAll(IDENTIFIER)].map((match) => match[0]).filter((token) => !/^v?\d+(?:\.\d+)*$/.test(token))

export function retentionOf(content, compressed) {
  const before = identifierList(content)
  if (before.length === 0) {
    return { uniq: 1, occ: 1, uniqueKept: 0, uniqueTotal: 0, occurrencesKept: 0, occurrencesTotal: 0 }
  }

  const uniqueBefore = new Set(before)
  const after = identifierList(compressed)
  const afterSet = new Set(after)
  const afterCounts = new Map()
  for (const token of after) afterCounts.set(token, (afterCounts.get(token) ?? 0) + 1)

  let uniqueKept = 0
  for (const token of uniqueBefore) if (afterSet.has(token)) uniqueKept += 1

  const occurrences = new Map()
  for (const token of before) occurrences.set(token, (occurrences.get(token) ?? 0) + 1)
  let occurrencesKept = 0
  for (const [token, count] of occurrences) occurrencesKept += Math.min(count, afterCounts.get(token) ?? 0)

  return {
    uniq: uniqueKept / uniqueBefore.size,
    occ: occurrencesKept / before.length,
    uniqueKept,
    uniqueTotal: uniqueBefore.size,
    occurrencesKept,
    occurrencesTotal: before.length,
  }
}

const MARKER = /"?<<hr:[^>]*>>"?/g
const neutralize = (text) =>
  text.replace(MARKER, '"<<marker>>"').replace(/<<hr:keys:[^>]*>>/g, '"HIDDEN_KEYS"')

/** The JSON document, without the trailing key-legend marker line. */
export const jsonDocument = (compressed) => {
  const newline = compressed.indexOf('\n')
  return newline === -1 ? compressed : compressed.slice(0, newline)
}

/** The key lists `schema` markers declare: `<digest>:<k1>|<k2>|...`. */
export const declaredKeys = (text) => {
  const found = []
  for (const match of text.matchAll(/<<hr:schema:([^>]*)>>/g)) {
    const keys = match[1].split(':').slice(1).join(':')
    if (keys !== '') found.push(keys.split('|'))
  }
  return found
}

/**
 * Structural fidelity of a compressed JSON document.
 *
 * Text retention is the wrong ruler for key-factored JSON: when a payload
 * repeats one record shape the handler hoists the key list into a marker and
 * writes values positionally, so `"route":` disappears from the text while every
 * record survives. Parse both sides and compare record counts and key sets.
 */
export function jsonShape(content, compressed) {
  const original = JSON.parse(content)
  let parsed = null
  try {
    parsed = JSON.parse(neutralize(jsonDocument(compressed)))
  } catch {
    return { parses: false, recordsBefore: 0, recordsAfter: 0, keySetsMatch: false, keysDeclared: 0 }
  }

  let recordsBefore = 0
  let recordsAfter = 0
  let keySetsMatch = true
  for (const [name, before] of Object.entries(original)) {
    if (!Array.isArray(before)) continue
    const after = Array.isArray(parsed[name]) ? parsed[name] : []
    // A schema marker rides as the array's first element; it is not a record.
    const records = after.filter((entry) => typeof entry !== 'string')
    recordsBefore += before.length
    recordsAfter += records.length
    const sampleBefore = before.find((entry) => entry !== null && typeof entry === 'object')
    const sampleAfter = records.find((entry) => entry !== null && typeof entry === 'object' && !Array.isArray(entry))
    if (sampleBefore !== undefined && sampleAfter !== undefined) {
      if (Object.keys(sampleBefore).join('|') !== Object.keys(sampleAfter).join('|')) keySetsMatch = false
    }
  }

  const declared = declaredKeys(compressed)
  return {
    parses: true,
    recordsBefore,
    recordsAfter,
    keySetsMatch,
    keysDeclared: declared.length === 0 ? 0 : Math.max(...declared.map((keys) => keys.length)),
  }
}

// ── the measurement itself ──────────────────────────────────────────────────

/**
 * Compress every payload in the generated corpus and measure what happened.
 *
 * @returns `{ rows, index, total }` where `total` is the whole corpus folded.
 */
export async function measureCorpus(tool, { ratio = 'balanced' } = {}) {
  const index = readIndex()
  const rows = []

  for (const conversation of index.conversations) {
    for (const payload of conversation.payloads) {
      const path = join(CONVERSATIONS, conversation.id, payload.name)
      const content = readFileSync(path, 'utf8')

      const started = performance.now()
      // Through `path`, which is how a session should feed a file to this tool
      // and the only mode that is accepted for payloads past the content limit.
      const { result } = await compressPayload(tool, { content, label: payload.name, ratio })
      const elapsed = performance.now() - started

      if (result.compressed === undefined) {
        // A `savedTokens: 0` refusal returns the original with a reason; an error
        // object carries `error` instead. Both mean nothing was stored.
        rows.push({
          conversation: conversation.id, title: conversation.title, payload: payload.name,
          kind: result.kind ?? 'refused', refused: true, note: String(result.note ?? result.error ?? ''),
          charsBefore: content.length, charsAfter: content.length,
          ownBefore: result.originalTokens ?? 0, ownAfter: result.originalTokens ?? 0,
          meterBefore: meterTokens(content), meterAfter: meterTokens(content),
          savedPercent: 0, retention: { uniq: 1, occ: 1 }, lossless: true, elided: false, shape: null,
          transforms: result.transforms ?? [], elapsed,
        })
        continue
      }

      // A pass is only a saving if the original comes back intact.
      const back = await tool.execute({ action: 'retrieve', token: result.token })
      const meterBefore = meterTokens(content)
      const meterAfter = meterTokens(result.compressed)

      rows.push({
        conversation: conversation.id,
        title: conversation.title,
        payload: payload.name,
        kind: result.kind,
        detected: result.detected,
        confident: result.confident !== false,
        truncated: result.truncated === true,
        refused: false,
        charsBefore: content.length,
        charsAfter: result.compressed.length,
        ownBefore: result.originalTokens,
        ownAfter: result.compressedTokens,
        meterBefore,
        meterAfter,
        savedPercent: (100 * (meterBefore - meterAfter)) / meterBefore,
        retention: retentionOf(content, result.compressed),
        lossless: back.original === content,
        // Does the visible text say something was hidden? A marker carrying
        // `hidden=<n>` is what keeps a partial payload from looking complete.
        elided: /<<hr:[a-z]+:[^>]*hidden=\d+/.test(result.compressed),
        shape: result.kind === 'json' ? jsonShape(content, result.compressed) : null,
        transforms: result.transforms ?? [],
        elapsed,
      })
    }
  }

  return { rows, index, total: fold(rows) }
}

/** Sum a set of rows into corpus-level figures. */
export function fold(rows) {
  const sum = (pick) => rows.reduce((total, row) => total + pick(row), 0)
  const meterBefore = sum((row) => row.meterBefore)
  const meterAfter = sum((row) => row.meterAfter)
  const ownBefore = sum((row) => row.ownBefore)
  const ownAfter = sum((row) => row.ownAfter)
  return {
    payloads: rows.length,
    charsBefore: sum((row) => row.charsBefore),
    charsAfter: sum((row) => row.charsAfter),
    meterBefore,
    meterAfter,
    ownBefore,
    ownAfter,
    savedPercent: meterBefore === 0 ? 0 : (100 * (meterBefore - meterAfter)) / meterBefore,
    ownSavedPercent: ownBefore === 0 ? 0 : (100 * (ownBefore - ownAfter)) / ownBefore,
    elapsed: sum((row) => row.elapsed),
  }
}

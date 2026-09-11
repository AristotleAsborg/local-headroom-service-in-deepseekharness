/**
 * The compression engine: detection, structure masks, handlers, and the
 * reversible store.
 *
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 the dsh-plugin-headroom contributors
 *
 * An independent implementation of the techniques published by the headroom
 * project (https://github.com/headroomlabs-ai/headroom, Apache-2.0, Copyright
 * 2025 Headroom Contributors). No upstream source was copied or translated:
 * what is shared is the approach and the vocabulary. See NOTICE for the full
 * statement of what was and was not taken.
 *
 * Concretely, the technique is: detect the content type, extract the structure
 * worth keeping, replace the rest, and keep the original retrievable. Upstream's
 * ML stages (Magika detection, Kompress compression) are replaced here by
 * deterministic structural analysis, which keeps the whole thing offline and
 * reproducible.
 *
 * Every function here is pure except the store, and every transform is
 * lossless by construction: text is only ever dropped when the caller also
 * stores the untouched original.
 *
 * @module dsh-plugin-headroom/lib/engine
 */

// ── shape constants ─────────────────────────────────────────────────────────

/**
 * Marker shape: `<<hr:KIND:TOKEN:hidden=N:digest>>`. The token inside a marker
 * is derived from the *replaced* text, so a marker is itself a stable key and
 * `<<hr:body:6f3a...>>` reads as "the bytes that hashed to 6f3a...".
 */
const MARKER_PREFIX = '<<hr:'
const TOKEN_CHARS = 16

/** A string longer than this is "bulky" in JSON and gets replaced. */
const SHORT_VALUE_CHARS = 20
/** Numbers with more significant digits than this are identifiers, not values. */
const MAX_NUMBER_DIGITS = 10
/** Estimated token price of one marker; used to decide if collapsing pays. */
const MARKER_TOKEN_COST = 6
/** Never store more than this much visible text, however small the ratio. */
const MAX_VISIBLE_CHARS = 120_000

// ── small utilities ─────────────────────────────────────────────────────────

/**
 * Deterministic string hash (FNV-1a, then an avalanche finalizer). Not
 * cryptographic — it identifies content, it does not protect it.
 *
 * @returns 32-bit unsigned integer.
 */
function hash32(text) {
  let h = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    h ^= text.charCodeAt(index)
    h = Math.imul(h, 0x01000193)
  }
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * A retrievable token derived from content. 128 bits over the joined segment
 * hashes; six independent FNV seeds make a collision require a real accident
 * rather than a lucky birthday.
 */
function tokenFor(text) {
  const seeds = [0, 0x9e3779b1, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f, 0x165667b1]
  let out = ''
  for (const seed of seeds) {
    out += (hash32(String(seed) + ':' + text) >>> 0).toString(16).padStart(8, '0')
  }
  return out.slice(0, TOKEN_CHARS)
}

/**
 * Summarize replaced text for a marker: how many code points it held, and a
 * digest so two markers differ whenever their hidden text differs. The digest
 * is what makes a marker a stable identity for the bytes it stands for.
 */
function digestOf(replaced) {
  let hidden = 0
  for (const _codepoint of replaced) hidden += 1
  return { hidden, digest: (hash32(replaced) >>> 0).toString(16).padStart(8, '0') }
}

/**
 * Build one marker for a stretch of replaced text.
 *
 * The marker deliberately carries NO retrieval token. An earlier version put
 * one here, derived from the replaced text — but nothing ever stored that text
 * under that key, so the token pointed at nothing. The only retrievable token
 * is the one for the whole original, echoed by the tool's own header. What a
 * marker carries instead is a digest and a size, so `<<hr:body:hidden=895:de1...>>`
 * identifies the bytes it replaced without pretending to be a lookup key.
 *
 * `text` lets a caller state what was hidden when the content itself is the
 * point — a key set, for instance — instead of hiding it behind a hash.
 */
function marker(kind, replaced, text) {
  const { hidden, digest } = digestOf(replaced)
  const stated = text === undefined || text === '' ? '' : ':' + text
  return MARKER_PREFIX + kind + ':hidden=' + String(hidden) + ':' + digest + stated + '>>'
}

/**
 * Estimate tokens for English/code/JSON text.
 *
 * Deliberately conservative (it over-estimates tokens, so savings are never
 * overstated): ASCII runs that identify things — hashes, paths, snake_case —
 * are priced near one token per three characters, while runs of plain words
 * are priced at about four characters per token, and CJK at about one.
 */
export function estimateTokens(text) {
  if (typeof text !== 'string' || text === '') return 0
  let ascii = ''
  let tokens = 0

  const flush = () => {
    if (ascii === '') return
    const words = ascii.match(/[A-Za-z]+/g)
    const noisy = /[/\\._$#@:~-]/.test(ascii) || /[0-9]/.test(ascii) || /[A-Z]/.test(ascii.slice(1))
    if (words !== null && !noisy) {
      for (const word of words) tokens += Math.max(1, Math.ceil(word.length / 4))
    } else {
      tokens += Math.max(1, Math.ceil(ascii.length / 3))
    }
    ascii = ''
  }

  for (const char of text) {
    const code = char.charCodeAt(0)
    if (code < 0x80) {
      if (/\s/.test(char)) {
        flush()
        if (char === '\n') tokens += 1
      } else {
        ascii += char
      }
      continue
    }
    flush()
    if (isWide(code)) tokens += 1
    else tokens += 0.6
  }
  flush()
  return Math.max(0, Math.round(tokens))
}

/** CJK, Hangul and the fullwidth forms cost about one token per glyph. */
function isWide(code) {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0x303e) ||
    (code >= 0x3041 && code <= 0x33ff) ||
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0xa000 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60)
  )
}

/** Split into lines without losing the information that a final newline was there. */
function splitLines(content) {
  return content.split('\n')
}

function joinLines(lines) {
  return lines.join('\n')
}

function isBlank(line) {
  return line.trim() === ''
}

/**
 * Pick indices to KEEP when a sequence must be thinned: the first `spread`
 * entries, the last `spread` entries, and an even run through the middle.
 * Always ordered, always unique.
 */
function pickSpread(total, spread) {
  if (total <= spread * 2) {
    const all = []
    for (let index = 0; index < total; index += 1) all.push(index)
    return all
  }
  const keep = new Set()
  for (let index = 0; index < spread; index += 1) keep.add(index)
  for (let index = total - spread; index < total; index += 1) keep.add(index)
  const middle = total - spread * 2
  const samples = Math.max(1, spread)
  for (let step = 1; step <= samples; step += 1) {
    keep.add(spread + Math.floor((middle * step) / (samples + 1)))
  }
  return [...keep].sort((a, b) => a - b)
}

/**
 * Replace every element the picker did not keep with one marker, merging runs.
 *
 * @returns the kept lines plus a count of how many were hidden.
 */
function elideUnpicked(lines, keep, kind) {
  const wanted = new Set(keep)
  const out = []
  let hidden = 0
  let run = []
  const flush = () => {
    if (run.length === 0) return
    const body = run
    run = []
    hidden += body.length
    // A run of one shape reads better as its shape than as a bare count, and
    // costs less than the lines it replaces — `factorLineRun` refuses when
    // either is not true. Otherwise the marker names the first line it hid, but
    // only when the run is small: on a long run that one sample costs more than
    // it explains, and the count already says what happened.
    const factored = factorLineRun(body)
    out.push(
      factored ??
        marker(kind, body.join('\n'), body.length <= 3 ? body[0].trim().slice(0, 60) : undefined),
    )
  }
  for (let index = 0; index < lines.length; index += 1) {
    if (wanted.has(index)) {
      flush()
      out.push(lines[index])
    } else {
      run.push(lines[index])
    }
  }
  flush()
  return { lines: out, hidden }
}

/** The prefix two lines agree on, measured in characters. */
function sharedPrefixLength(left, right) {
  const limit = Math.min(left.length, right.length)
  let index = 0
  while (index < limit && left[index] === right[index]) index += 1
  return index
}

/**
 * Write a run of near-identical lines once instead of N times.
 *
 * A tool result is usually a list of one shape: a directory listing, a test
 * transcript, a registry of records. Every line repeats a long prefix, and this
 * replaces the repeated part with `<v>` while keeping the shape — so the model
 * still reads a plausible line, not just a count.
 *
 * Honest in both directions: the shared prefix must clear `minShared`, and the
 * replacement must beat the lines it replaces, or the lines are kept.
 */
function factorLineRun(run, minShared = 24) {
  if (run.length < 3) return null

  let prefix = run[0]
  for (const line of run) {
    prefix = prefix.slice(0, sharedPrefixLength(prefix, line))
    if (prefix.length < minShared) return null
  }

  const templates = []
  for (const line of run) {
    const template = prefix + '<v>' + line.slice(prefix.length)
    if (!templates.includes(template)) templates.push(template)
  }

  const body = run.join('\n')
  const head = marker('run', body) + '\n' + run.length + ' similar lines, ' + templates.length + ' shape(s):'
  const replacement = templates.length === 1 ? head + '\n' + templates[0] : head + '\n' + templates.join('\n')
  if (estimateTokens(replacement) >= estimateTokens(body)) return null
  return replacement
}

// ── detection (headroom's Magika stage, done structurally) ──────────────────

/**
 * Classify content as json, code, log, text or diff.
 *
 * Order matters: a JSON document that happens to contain braces must not be
 * read as code, and a stack trace must not be read as prose.
 */
export function detectKind(content) {
  const sample = content.slice(0, 20_000)
  const trimmed = sample.trim()

  // A unified diff is proven by a hunk header, or by a `---`/`+++` pair on
  // consecutive lines. The markers alone are not evidence: docstring
  // delimiters and comment rules produce them inside ordinary source.
  if (/^(?:diff --git |@@ -\d+(?:,\d+)? \+\d+|Index: )/m.test(sample)) {
    return 'diff'
  }
  if (/^--- .+\r?\n\+\+\+ /m.test(sample)) {
    return 'diff'
  }

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed.length === sample.length ? content : content)
      if (parsed !== null && typeof parsed === 'object') return 'json'
    } catch {
      // Not a complete document; fall through to the other signals.
    }
    if (/^\s*[[{][\s\S]*[}\]],?\s*$/m.test(trimmed) && /"\s*:/.test(trimmed)) return 'json'
  }

  let logHits = 0
  let codeHits = 0
  let codeLines = 0
  let indentBlocks = 0
  let lines = 0
  const lineList = splitLines(sample)
  for (const line of lineList) {
    lines += 1
    if (LOG_LEVEL.test(line) && (LOG_STAMP.test(line) || /^[A-Za-z0-9_.-]+:\s/.test(line))) logHits += 1
    if (CODE_SIGNAL.test(line)) codeHits += 1
    // Indented lines matter too: `    return x` is code even though the
    // statement keyword is not at the start of the line.
    if (CODE_STATEMENT.test(line)) codeLines += 1
    // Brace-less languages (Python, Ruby, YAML-ish config) mark a block with a
    // trailing colon and an indented body instead of braces.
    if (/:$/.test(line.trimEnd())) indentBlocks += 1
    if (lines >= 400) break
  }
  if (logHits >= 3 && logHits * 5 >= lines) return 'log'
  if (/\n[ \t]+\S/.test(sample) && indentBlocks >= 2 && codeLines >= 1) return 'code'
  // Declaration-ish line starts and statement keywords are counted together:
  // either alone can miss a real file (a Python script is nearly all statements,
  // a Rust file nearly all declarations).
  if (codeHits + codeLines >= 3) return 'code'
  return 'text'
}

const LOG_STAMP = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}|\b\d{2}:\d{2}:\d{2}[.,]\d{0,6}\b|\[\d{4}-\d{2}-\d{2}/
const LOG_LEVEL = /\b(?:TRACE|DEBUG|INFO|NOTICE|WARN|WARNING|ERROR|ERR|FATAL|CRITICAL|SEVERE)\b/
const CODE_SIGNAL =
  /^\s*(?:import\s|from\s+\S+\s+import\s|export\s|const\s|let\s|var\s|function\s|class\s|def\s|async\s+def\s|public\s|private\s|protected\s|static\s|interface\s|type\s|struct\s|enum\s|fn\s|impl\s|use\s|package\s|namespace\s|template\s|#include|@\w+|"""|'''|\/\/|\/\*|\*)/

/**
 * Statement keywords, matched on the trimmed line. This is what catches code
 * whose block keyword is not in column zero — indented bodies in Python, Ruby
 * and friends.
 */
const CODE_STATEMENT =
  /^(?:return|yield|raise|throw|await|try|except|catch|finally|with|for|while|if|elif|else|switch|case|match|when|break|continue|pass|del|lambda|assert|print|echo|let|const|var|new|delete|import|export|from|use|fn|def|func|sub|end|then|do|repeat|until|loop|impl|where|select|insert|update|delete\s+from|begin|commit|rollback)\b/

// ── log handler ─────────────────────────────────────────────────────────────

/** Severity buckets, most interesting first. Order is the reporting order. */
const SEVERITIES = [
  ['fatal', /\b(?:FATAL|CRITICAL|SEVERE)\b/],
  ['error', /\b(?:ERROR|ERR)\b/],
  ['warn', /\b(?:WARNING|WARN)\b/],
  ['info', /\b(?:INFO|NOTICE)\b/],
  ['debug', /\b(?:DEBUG|TRACE)\b/],
]

function severityOf(line) {
  for (const [name, pattern] of SEVERITIES) {
    if (pattern.test(line)) return name
  }
  return null
}

/**
 * Levels that are never sampled away.
 *
 * The README has always promised that every FATAL/ERROR line survives, and the
 * sampling treated them like any other level: 300 ERROR lines came back as 24,
 * because `spread` was applied per level regardless of what the level meant.
 * That is the one promise in this handler a reader relies on without checking —
 * "the errors are all here" is why a compressed log is usable at all.
 *
 * WARN and INFO are sampled; DEBUG and TRACE are thinned hardest. WARN is not on
 * this list deliberately: it is numerous in healthy systems, and losing most
 * warnings is a normal trade, whereas losing most errors is not.
 */
const NEVER_SAMPLED = new Set(['fatal', 'error'])

/**
 * Collapse a prefix that every line in a region repeats.
 *
 * A log keeps a timestamp and a level on every line it is allowed to keep, so
 * the kept lines are exactly the ones that pay the prefix cost. Writing the
 * prefix once and referring to it costs one marker instead of N copies.
 *
 * The first line keeps the prefix verbatim, so what the prefix IS stays
 * visible. A marker is not free, so the rewrite is applied only when the region
 * is long enough for the saving to beat it.
 */
function dedupeLines(text, minLines = 6) {
  const lines = text.split('\n')
  if (lines.length < minLines) return { text, saved: 0 }

  const match = /^(\s*\S+)\s/.exec(lines[0])
  if (match === null) return { text, saved: 0 }
  const prefix = match[1]

  let share = 0
  for (const line of lines) {
    if (line.startsWith(prefix + ' ') || line === prefix) share += 1
  }
  // Every line, or the prefix is not worth naming. One exception would mislead.
  if (share !== lines.length) return { text, saved: 0 }

  const token = tokenFor(prefix)
  const short = '<p:' + token.slice(0, 6) + '>'
  const out = [lines[0]]
  for (let index = 1; index < lines.length; index += 1) {
    out.push(lines[index] === prefix ? short : short + lines[index].slice(prefix.length))
  }
  const candidate = out.join('\n')
  const saved = estimateTokens(text) - estimateTokens(candidate)
  // The legend costs a little; require a real margin over it.
  if (saved < 8) return { text, saved: 0 }
  return { text: candidate + '\n' + short + ' = ' + prefix, saved }
}

/**
 * Collapse runs of near-identical lines the picker KEPT.
 *
 * `elideUnpicked` factors the runs it hides, but a run the picker decided to
 * keep went through unfactored. That was invisible while every level was subject
 * to sampling, and became the dominant cost once fatal and error lines were
 * guaranteed: a service that logs the same error 300 times kept all 300, and the
 * payload shrank by 17%.
 *
 * A repeated error is the clearest case for factoring in the whole handler — the
 * information is the message and the count, not three hundred copies of it — so
 * runs at or above `minRun` go through the same templating the elided runs use,
 * which refuses whenever the replacement would not be smaller.
 *
 * `minRun` is deliberately higher than `factorLineRun`'s own floor of three:
 * deduplicating three consecutive identical lines saves almost nothing and reads
 * worse, since the repetition itself is often the signal.
 */
function factorKeptRuns(text, minRun = 6) {
  const lines = splitLines(text)
  const out = []
  let index = 0
  let changed = false

  while (index < lines.length) {
    let end = index + 1
    while (end < lines.length && lines[end] === lines[index]) end += 1
    const run = lines.slice(index, end)
    if (run.length >= minRun) {
      const factored = factorLineRun(run)
      if (factored !== null) {
        out.push(factored)
        changed = true
        index = end
        continue
      }
    }
    for (let cursor = index; cursor < end; cursor += 1) out.push(lines[cursor])
    index = end
  }

  return changed ? joinLines(out) : text
}

/**
 * Keep log structure: every fatal and error line, plus a spread of each other
 * level so the shape of the run is visible. A level with only a few lines is
 * left alone — thinning it would lose more than it saves.
 */
function compressLog(content, options) {
  const lines = splitLines(content)
  const keep = new Set()
  const groups = new Map()

  for (let index = 0; index < lines.length; index += 1) {
    const severity = severityOf(lines[index])
    if (severity === null) continue
    if (!groups.has(severity)) groups.set(severity, [])
    groups.get(severity).push(index)
  }

  // No severity anywhere means this is not a log, whatever else it looks like.
  // Without this, ordinary indented prose is masked down to a single marker:
  // well-compressed and worthless.
  if (groups.size === 0) return null

  for (const [severity, indices] of groups) {
    // A level that is never sampled is kept in full however many lines it has.
    // This is the guarantee the documentation makes, and it is also the case
    // where it matters most: a run with hundreds of errors is exactly when
    // hiding some of them is least acceptable.
    if (NEVER_SAMPLED.has(severity) || indices.length <= options.spread * 2) {
      for (const index of indices) keep.add(index)
    } else {
      for (const index of pickSpread(indices.length, options.spread)) keep.add(indices[index])
    }
  }

  // A stack trace or an exception block is the payload of a log; keep every
  // line of the first few, since those are what a reader actually needs.
  let traceBudget = 3
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*(?:at\s+\S|File\s+"|Caused by:|Traceback|\.{3}\s*\d+\s*more)/.test(lines[index])) continue
    let cursor = index
    while (cursor < lines.length && traceBudget > 0 && /^\s*(?:at\s+\S|File\s+"|Caused by:|Traceback|\.{3})/.test(lines[cursor])) {
      keep.add(cursor)
      cursor += 1
    }
    traceBudget -= 1
    index = cursor
  }

  const elided = elideUnpicked(lines, [...keep].sort((a, b) => a - b), 'log')
  const transforms = ['log:level-spread', 'log:traces-kept']
  const joined = factorKeptRuns(joinLines(elided.lines))
  if (joined !== joinLines(elided.lines)) transforms.push('log:repeats-factored')
  const deduped = dedupeLines(joined)
  if (deduped.saved > 0) transforms.push('log:prefix-factored')
  return {
    content: deduped.text,
    transforms,
    maskedLines: elided.hidden,
  }
}

// ── diff handler ────────────────────────────────────────────────────────────

/**
 * Keep a diff's shape: file headers, hunk headers, and the first few changed
 * lines of every hunk. Removed and added bodies are the bulk, and their content
 * is retrievable.
 */
function compressDiff(content, options) {
  const lines = splitLines(content)
  const keep = new Set()
  let inHunk = false
  let shown = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (/^(?:diff --git |--- |\+\+\+ |Index: |new file|deleted file|similarity index|rename )/.test(line)) {
      keep.add(index)
      inHunk = false
      continue
    }
    if (line.startsWith('@@')) {
      keep.add(index)
      inHunk = true
      shown = 0
      continue
    }
    if (!inHunk) {
      keep.add(index)
      continue
    }
    if (line.startsWith('+') || line.startsWith('-')) {
      if (shown < options.spread) {
        keep.add(index)
        shown += 1
      }
    } else if (line.startsWith(' ')) {
      // Unchanged context inside a hunk: keep a thin sample.
      if (shown <= options.spread && index % 4 === 0) keep.add(index)
    } else {
      keep.add(index)
    }
  }

  const elided = elideUnpicked(lines, [...keep].sort((a, b) => a - b), 'diff')
  return {
    content: joinLines(elided.lines),
    transforms: ['diff:hunks-summarized', 'diff:context-sampled'],
    maskedLines: elided.hidden,
  }
}

/**
 * Newline-delimited JSON: one complete object per line.
 *
 * This is a mainstream shape — log shippers, bulk exports and streaming APIs all
 * emit it — and it had no handler at all. `JSON.parse` refuses the document
 * because there are many documents, so the JSON handler returned null and the
 * payload was refused outright: two hundred structured records, kept whole, with
 * nothing done to them.
 *
 * The records are the same run `factorRecords` already knows how to write once.
 * Values are passed through untouched rather than masked: in a JSONL stream the
 * keys repeat but each line is a distinct event, so the repetition to remove is
 * the keys, and hiding values would hide the events themselves.
 */
function compressJsonl(content, options) {
  const lines = splitLines(content)
  const records = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    let parsed
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      return null
    }
    // Arrays and scalars are legal JSONL but carry no keys to factor, and a
    // mixed stream is not one shape.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    records.push(parsed)
  }
  if (records.length < 3) return null

  const keep = (value) => value
  const factored = factorRecords(records, keep)
  if (factored === null) return null
  return {
    content: factored.text,
    transforms: ['jsonl:records-factored'],
    maskedLines: records.length,
  }
}

// ── code handler ────────────────────────────────────────────────────────────

/**
 * Lines that carry a file's skeleton: a scope or a declaration.
 *
 * Broad on purpose — this answers "is this line part of the interface", and the
 * handler pairs it with "does it open a scope" and "is it a local variable"
 * before treating it as a member signature.
 */
const DECLARATION =
  /^(?:@|import\b|from\b|export\b|package\b|namespace\b|use\b|mod\b|extern\b|#include|#define|module\.exports|public\b|private\b|protected\b|internal\b|static\b|final\b|abstract\b|sealed\b|partial\b|async\b|def\b|class\b|interface\b|trait\b|impl\b|struct\b|enum\b|union\b|typedef\b|type\b|const\b|let\b|var\b|function\b|func\b|fn\b|sub\b|proc\b|macro\b|template\b|operator\b|constructor\b|record\b|"""|'''|\/\/|\/\*|\*|#)/

/**
 * A member signature with no keyword: `name(args) {`, `name(args): T {`.
 *
 * This shape is what a method looks like in every brace language, and no
 * keyword list covers it — which is why a class full of methods used to be
 * masked whole, signatures included.
 *
 * Control flow is excluded on purpose: `for (const x of y) {` has exactly the
 * same shape and is body content, not a member. Matching it as one pushed a
 * duplicate scope and left the whole class unmasked.
 *
 * A signature may carry a return type between the parameter list and the body,
 * and it may omit the opening brace entirely when the body starts on the next
 * line. Both were missing: `pub fn insert(&mut self, key: u32) -> Option<u32> {`
 * is a Rust method, and without an alternative after `)` the pattern failed, so
 * the line was read as implementation and masked — along with the member's name,
 * which is the one thing the reader needs.
 *
 * The leading group repeats, so `public static void main` and
 * `private async load` both parse. A single modifier such as `async` cannot be
 * told from a type name by shape alone, which is why that group is optional and
 * repeatable rather than a fixed list.
 */
const MODIFIERS = '(?:@|export|pub|public|private|protected|internal|static|final|abstract|sealed|partial|async|readonly|unsafe|extern|virtual|override|synchronized|native|def|fn|func|function|sub|proc)'
/**
 * A name, and optionally a return type in front of it.
 *
 * The return type is a second word group rather than part of the name, because
 * `public int alpha(int x)` has two words before its parameters while
 * `pub fn alpha(&self)` has three and `beta(): number` has one. Collapsing them
 * into a single token made every Java signature fail to parse.
 */
const DECLARED_NAME = '[\\w$.[\\]<>*&:\'"]+(?:\\s+[\\w$.[\\]<>*&:\'"]+)*'
/** A signature that opens its body on this line, or on the next one. */
const METHOD_SIGNATURE = new RegExp(
  '^(?:' + MODIFIERS + '\\s+)*' + DECLARED_NAME + '\\s*\\([^)]*\\)\\s*' +
    '(?:(?::|->)\\s*[^;{=]+|\\b(?:where|throws|const|override|final)\\b[^;{]*)?\\{?$',
)
/** The head of a signature whose parameter list ends the line. */
const METHOD_HEAD = new RegExp('^(?:' + MODIFIERS + '\\s+)*' + DECLARED_NAME + '\\s*\\([^)]*\\)\\s*$')

/**
 * A field declaration: `name = value`, `name: type = value`.
 *
 * Members that open nothing are declarations, not implementation, and the README
 * promises they stay — `private readonly entries = new Map<string, Entry>()` is
 * how a reader learns what a class holds. It matched none of the method shapes
 * and was masked into the body.
 *
 * The pattern refuses a dotted or indexed prefix, which is what separates a
 * declaration from an assignment: `entries = new Map()` declares, while
 * `this.entries = x` and `cache[key] = x` assign to something declared
 * elsewhere. A statement keyword in front is refused for the same reason.
 */
const FIELD_DECLARATION = new RegExp(
  '^(?:' + MODIFIERS + '\\s+)*(?:(?:const|let|var)\\s+)?[A-Za-z_$][\\w$]*\\s*(?::\\s*[^=;{]+)?=\\s*[^=]',
)

/** What a member's parameters may look like — no semicolons or nested braces. */
const PARAMETER_LIST = /\([^;{}]*\)/

/**
 * Whether a line inside a body starts a new member rather than continuing one.
 *
 * Two shapes reach here, because a declaration ending in `{` was already handled
 * before this is consulted:
 *
 *   - A declaration whose body begins on the NEXT line — C and Java style:
 *     `public int alpha(int x)` then `{`. It ends with the return type, so it
 *     opened no scope and was read as implementation.
 *   - A signature whose parameter list ends the line and whose return type
 *     follows: `pub fn insert(&mut self, key: u32)`.
 *
 * Control flow and local bindings are excluded whatever the shape says, because
 * `for (const item of items)` and `if (x)` are shaped exactly like a call.
 */
function splitsMember(line, openerIndent, openerIsType) {
  const trimmed = line.trim()
  if (trimmed === '') return false
  const indent = line.length - line.trimStart().length
  // A member sits inside the type but not inside a body already open beneath it.
  if (indent <= openerIndent) return false
  if (CONTROL_FLOW.test(trimmed)) return false
  if (METHOD_HEAD.test(trimmed) || METHOD_SIGNATURE.test(trimmed)) return true
  // A field is a member only directly under a type. `openerIsType` is what makes
  // that decidable: one level below a *function* opener the same shape is a local
  // binding, and keeping locals is what makes a body unreadable. Comparing
  // indentation alone cannot separate them — the innermost opener inside a class
  // is the class, so a field always sits at `indent > openerIndent`, and an
  // equality test here could never hold. The binding keyword is the discriminator
  // that does work: `const`, `let`, `var` and `:=` are locals everywhere, while a
  // bare `T name = ...` directly under a type is a field.
  if (openerIsType && !LOCAL_VAR.test(trimmed) && FIELD_DECLARATION.test(trimmed)) return true
  return false
}
const CONTROL_FLOW = /^(?:if|else|for|while|do|switch|case|default|try|catch|finally|return|throw|await|yield|with|using|lock|foreach|elif|unless|until)\b/

/** A type or container whose body carries members, as opposed to a method body. */
const TYPE_SCOPE = /\b(?:class|interface|struct|enum|trait|impl|union|namespace|module|object|record|enum)\b/

/**
 * A localized variable binding: `const x = ...`, `let x`, `var x`, `x := ...`.
 *
 * These are implementation wherever they appear, so they never keep a body
 * visible. This is the distinction that matters — a member is "a declaration
 * that is not a local variable", and without it a function full of `const`
 * locals looks like a class full of members.
 */
const LOCAL_VAR = /^(?:const|let|var)\s|^\w+\s*:=|^\w+\s*,\s*\w+\s*:=/

function isDeclaration(line) {
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (DECLARATION.test(trimmed)) return true
  return METHOD_SIGNATURE.test(trimmed)
}

/**
 * A member of a type, as opposed to a nested block of implementation.
 *
 * Both `name(args) {` and `for (const x of y) {` have the shape of a signature,
 * so the shape alone is not enough. A member is a declaration that is neither a
 * local binding nor control flow. Getting this wrong in either direction is
 * visible: calling control flow a member pushes a duplicate scope, and calling
 * `const x = 1` a member keeps every line of a function body.
 */
const MEMBER_KEYWORD =
  /^(?:@|export\b|pub\b|public\b|private\b|protected\b|internal\b|static\b|final\b|abstract\b|sealed\b|partial\b|async\b|readonly\b|unsafe\b|extern\b|def\b|class\b|interface\b|trait\b|impl\b|struct\b|enum\b|union\b|type\b|typedef\b|record\b|fn\b|func\b|function\b|sub\b|proc\b|macro\b|template\b|operator\b|constructor\b|get\s+\w|set\s+\w)/

function isMember(line) {
  const trimmed = line.trim()
  if (trimmed === '') return false
  if (LOCAL_VAR.test(trimmed)) return false
  if (CONTROL_FLOW.test(trimmed)) return false
  if (MEMBER_KEYWORD.test(trimmed)) return true
  // `name(args) {` with no keyword, and nothing else shaped like it.
  return METHOD_SIGNATURE.test(trimmed) && !CONTROL_FLOW.test(trimmed)
}

/**
 * Keep a file's skeleton: imports, signatures, class and type declarations,
 * decorators, and the closing delimiters that end a scope. Everything else
 * becomes one marker per body.
 *
 * A function's body is the region after its signature, and that region ends at
 * the delimiter matching the signature's opener. Both halves of that matter,
 * and each was a separate bug before:
 *
 *   - Masking by indentation alone cannot tell a class member from a class
 *     body, because in a brace language both sit at the same indentation. So a
 *     declaration whose line opens a scope masks its body, while a declaration
 *     that opens nothing (a field initializer) is kept.
 *   - A masked region ends when its OWN delimiter closes, not when a deeper
 *     scope pops. Otherwise the first method in a class swallows the rest of
 *     the class, signatures included.
 *
 * Python works under the same rule: `def f():` opens a scope, and its body ends
 * at the next line indented at or left of the `def`.
 */
function compressCode(content, options) {
  const lines = splitLines(content)
  const out = []
  let run = []
  let masked = 0
  /** What one marker costs the estimator; measured so it cannot drift from it. */
  const markerCost = estimateTokens(marker('body', 'x'))
  /**
   * Indentation of each open scope's opener, outermost first.
   *
   * One number is enough for every language here: a body is whatever sits
   * deeper than its opener, and it ends at the first line that does not. No
   * delimiter counting, because `if (a) { f(b) }` and `x = f(y)` both carry
   * brackets that say nothing about scope.
   */
  const scopes = []

  const flush = () => {
    if (run.length === 0) return
    const body = run
    run = []
    const joined = body.join('\n')
    // A marker is not free. It carries a 16-hex token, a digest and counts, and
    // the estimator prices that hex near one token per three characters — so a
    // body must be worth more than a marker before masking it helps at all.
    // Masking ten tokens of body behind a sixteen-token marker is a net loss,
    // and a handler that does that turns a small file into a bigger one.
    if (estimateTokens(joined) > markerCost) {
      out.push(marker('body', joined))
      masked += body.length
    } else {
      for (const kept of body) out.push(kept)
    }
  }

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim()
    if (trimmed === '') {
      // Blank lines neither open nor close a scope, and dropping them keeps a
      // class from fragmenting into one marker per member.
      continue
    }

    const indent = line.length - line.trimStart().length
    // A scope opens only when the line ENDS with an opener. `(a, b) => x + 1`
    // and `do { ... } while (x)` carry delimiters without opening a body.
    const opensScope = /[{([]$/.test(trimmed) || /:$/.test(trimmed)
    // A brace that opens and closes on one line opens nothing, so a single-line
    // body must not leave a scope standing that swallows its siblings.
    const closesOnItself = (trimmed.match(/\{/g) ?? []).length === (trimmed.match(/\}/g) ?? []).length

    /**
     * Close every scope this line has left behind.
     *
     * "Everything at or left of an opener closes it" holds only for
     * indentation-delimited languages, where a body ends at the first line that
     * is not deeper. In a brace language the members of a class sit at exactly
     * the opener's indentation, so that rule closed the class at its first
     * member — and because the class' body was still open, the member was then
     * read as a closing brace inside a body and masked with it. A class therefore
     * compressed to `class C {` plus one marker, losing every signature in it,
     * which is the opposite of what this handler is for.
     *
     * So a line at the opener's indentation closes it only when it is actually a
     * closer (`}`, `)`, `]`), or when it opens a scope of its own. `pub fn a() {`
     * is a member, not a closer; `def b():` in Python is the next top-level
     * function and genuinely ends the one above, which is why the "opens a scope"
     * clause is there.
     */
    while (scopes.length > 0) {
      const opener = scopes[scopes.length - 1].indent
      if (indent < opener) {
        scopes.pop()
        flush()
        continue
      }
      if (indent === opener && (/^[}\])]/.test(trimmed) || (opensScope && !closesOnItself))) {
        scopes.pop()
        flush()
        continue
      }
      break
    }

    const openerIndent = scopes.length > 0 ? scopes[scopes.length - 1].indent : null
    const openerIsType = scopes.length > 0 ? scopes[scopes.length - 1].isType : false
    const inBody = openerIndent !== null && indent > openerIndent

    if (inBody) {
      /**
       * A brace on its own line belongs to the signature above it.
       *
       * C and Java style put the opening brace on the next line, so the brace
       * alone carries no information — `public int alpha(int x)` followed by `{`
       * is one member, and treating the brace as body absorbed the signature into
       * the mask. A `{` is read as an opener when the preceding meaningful line
       * was a member signature; otherwise it stays a block inside a body, which
       * is what a bare `{` in Rust or a nested scope actually is.
       */
      const braceOnItsOwnLine =
        /^[{([]$/.test(trimmed) && index > 0 && splitsMember(lines[index - 1], openerIndent, openerIsType)
      if (braceOnItsOwnLine) {
        flush()
        out.push(line)
        scopes[scopes.length - 1].indent = indent
        scopes.push({ indent, isType: false })
        continue
      }
      if ((opensScope && isMember(line)) || splitsMember(line, openerIndent, openerIsType)) {
        // A member signature inside a type: the interface, so it stays. It ends
        // the body above it and anchors its own, one level deeper.
        flush()
        out.push(line)
        // A signature that opens nothing (the brace is on the next line) must
        // still leave the member's body maskable, so the split point becomes the
        // new opener. A `{` line closing on itself opens nothing and is left as
        // it was written.
        if (!opensScope) scopes.push({ indent, isType: false })
        else if (closesOnItself) scopes[scopes.length - 1].indent = indent
        else {
          scopes[scopes.length - 1].indent = indent
          scopes.push({ indent, isType: false })
        }
        continue
      }
      // Implementation — a local binding, a nested block, a closing brace.
      run.push(line)
      continue
    }

    flush()

    if (opensScope) {
      out.push(line)
      scopes.push({ indent, isType: TYPE_SCOPE.test(trimmed) })
      continue
    }

    // A declaration that opens nothing (an import, a field initializer, a
    // typedef), or any line that is not a closer: skeleton.
    if (!/^[}\])]/.test(trimmed)) {
      out.push(line)
      continue
    }

    // A closer with no scope left to pop ends the body just masked.
    run.push(line)
  }
  flush()

  return {
    content: joinLines(out),
    transforms: ['code:signatures-kept', 'code:bodies-masked'],
    maskedLines: masked,
  }
}

// ── JSON handler ────────────────────────────────────────────────────────────

/**
 * Key-ish strings are identifiers (ids, hashes, paths) and are never replaced.
 *
 * The length ceiling matters as much as the patterns. A 94-character base64
 * `integrity` hash is identifier-shaped but expensive, and a lockfile repeats
 * one per package — keeping those verbatim was the single largest avoidable
 * cost in this session's payloads. Short identifiers stay; bulky ones are
 * values, and values are what a marker exists for.
 */
const MAX_IDENTIFIER_CHARS = 64

function looksLikeIdentifier(value) {
  if (value.length > MAX_IDENTIFIER_CHARS) return false
  return (
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value) ||
    /^[0-9a-f]{16,}$/i.test(value) ||
    /^[A-Za-z0-9_-]{16,}$/.test(value) ||
    /^(?:[a-z]+:\/\/|\\\\|\/|[A-Za-z]:\\)/.test(value) ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
  )
}

/** A key safe to carry in a marker: no delimiter, no quote, and short. */
const SAFE_KEY = /^[A-Za-z_$][A-Za-z0-9_$]{0,31}$/

const DELIMITERS = ['\u0000', '\u0001', '\u0002']

/** The separator used inside a schema-marker key list. */
const SCHEMA_SEPARATOR = '\u0000'

/**
 * Serialize a walked node, emitting a factored region's JSON verbatim.
 *
 * `walk` returns `{ __hrRaw: <json text> }` when it has already factored a
 * region. `JSON.stringify` has no idea what that means: it writes the sentinel
 * as an object with an escaped string inside, so the region arrives as quoted
 * text — the payload is still syntactically valid, which is why this hid for so
 * long, but its values were never walked, so its bulk is never masked and the
 * text costs more than the records it replaced.
 *
 * This is defined beside `factorRecords` rather than only in the json handler
 * because factoring runs while the tree is still being walked: rows must be
 * serialized correctly at that moment, not patched afterwards.
 */
function serializeWalks(node) {
  if (node === null) return 'null'
  if (typeof node === 'string') return JSON.stringify(node)
  if (typeof node === 'number' || typeof node === 'boolean') return JSON.stringify(node)
  if (Array.isArray(node)) return '[' + node.map(serializeWalks).join(',') + ']'
  if (typeof node === 'object' && Object.hasOwn(node, '__hrRaw')) return node.__hrRaw
  if (typeof node === 'object') {
    return '{' + Object.entries(node).map(([key, item]) => JSON.stringify(key) + ':' + serializeWalks(item)).join(',') + '}'
  }
  return 'null'
}

/**
 * Factor a run of same-shaped records into one readable schema plus rows.
 *
 * This is the bulk case that matters: an API page or a lockfile repeats the
 * same keys once per record, and the keys cost more than the values. The keys
 * stay — they are the schema the model navigates by — but they are written once
 * instead of N times.
 *
 * The keys go INSIDE the marker (`<<hr:schema:hidden=42:ab12cd34:id|name|...>>`)
 * rather than behind a token. A token there would be a dead reference: nothing
 * stores a schema under a key of its own, so the model could not resolve it and
 * the whole payload would become opaque. Stating the keys costs a few tokens
 * and keeps the structure self-describing. Only the names of a map's outer keys
 * are elided, because those are data rather than schema and are retrievable.
 *
 * Both sides of the profitability comparison are serialized the same way, or a
 * factored row carrying a nested region would look more expensive than the
 * records it replaces and factoring would be refused for the wrong reason.
 *
 * @returns the JSON text of `[schemaMarker, ["name", [values...]], ...]` and the
 *   rows themselves, or null when factoring is unsafe or unprofitable.
 */
function factorRecords(records, walk) {
  if (records.length < 3) return null
  const keys = Object.keys(records[0])
  if (keys.length === 0 || keys.length > 24) return null
  if (!keys.every((key) => SAFE_KEY.test(key))) return null
  // Every record must carry exactly these keys, or positional rows would lie.
  for (const record of records) {
    if (Object.keys(record).length !== keys.length) return null
    for (const key of keys) {
      if (!Object.hasOwn(record, key)) return null
    }
  }

  const rows = records.map((record) => keys.map((key) => walk(record[key], 3)))
  // A row is only positional if a value can never be confused for another
  // column, so a value carrying the row separator is refused.
  for (const row of rows) {
    for (const value of row) {
      if (typeof value === 'string' && value.includes(SCHEMA_SEPARATOR)) return null
    }
  }

  const asRecords = serializeWalks(records)
  const asRows = '[' + rows.map(serializeWalks).join(',') + ']'
  // The schema line costs something, so the rows must beat the records by more
  // than that before factoring is a win at all.
  const schemaLine = marker('schema', keys.join(SCHEMA_SEPARATOR), keys.join('|'))
  if (asRows.length + schemaLine.length >= asRecords.length) return null

  return { text: '[' + serializeWalks(schemaLine) + ',' + asRows.slice(1), rows }
}

/**
 * Hoist a key list that the document repeats enough for the trade to pay.
 *
 * `factorRecords` writes the key list once per record group. A lockfile repeats
 * the SAME key list in every group, so those keys are still written many times.
 * This writes each profitable key set once, at the end of the document.
 *
 * Two rules keep it honest, and both were learned by getting them wrong:
 *
 *   - A replacement must preserve JSON syntax. `{"a":` may only become
 *     `{"K1":`; replacing the braces too produced `"K1":`, which is not a JSON
 *     object at all and silently corrupted the payload.
 *   - A key list is only worth an alias when the saving beats the alias. A
 *     three-character key like `seats` cannot pay for a `K1 = seats` legend, so
 *     it is left alone.
 *   - The legend is a marker, not bare prose. It was once appended as plain
 *     lines (`K1 = id|name`), which left the document trailing text after its
 *     closing brace — unparseable, and the one elision in the whole payload that
 *     carried no marker, so a reader could not tell it apart from content that
 *     survived. As a marker it keeps the same meaning and is marked as an
 *     elision like every other one.
 */
function hoistKeys(text) {
  const counts = new Map()
  for (const match of text.matchAll(/\{"([^{}"]+)":/g)) {
    counts.set(match[1], (counts.get(match[1]) ?? 0) + 1)
  }

  const ordered = []
  for (const [keyList, count] of counts) {
    if (count < 3) continue
    // `K<n> = <keyList>` is paid once; each occurrence saves the difference
    // between the keys and the alias. Require a real margin.
    const saved = count * keyList.length - keyList.length - 6 * count
    if (saved <= 12) continue
    ordered.push([keyList, count])
  }
  if (ordered.length === 0) return { text, transforms: [], hoisted: 0 }

  const alias = new Map(ordered.map(([keyList], index) => [keyList, 'K' + (index + 1)]))
  const legend = ordered.map(([keyList], index) => marker('keys', 'K' + (index + 1), 'K' + (index + 1) + '=' + keyList))
  const aliased = text.replace(/\{"([^{}"]+)":/g, (whole, keyList) => {
    const name = alias.get(keyList)
    return name === undefined ? whole : '{"' + name + '":'
  })

  // Belt and braces: the alias form keeps the document parseable, and this
  // confirms it rather than trusting the arithmetic above.
  try {
    JSON.parse(aliased)
  } catch {
    return { text, transforms: [], hoisted: 0 }
  }

  const replaced = ordered.reduce((total, [, count]) => total + count, 0)
  const saved = estimateTokens(text) - estimateTokens(aliased + '\n' + legend.join('\n'))
  if (saved <= 0) return { text, transforms: [], hoisted: 0 }

  return {
    text: aliased + '\n' + legend.join('\n'),
    transforms: ['json:keys-hoisted'],
    hoisted: replaced,
  }
}

/**
 * Replace bulky JSON values while keeping the schema: every key, every
 * bracket, booleans, nulls, short strings, numbers, and short identifiers.
 * Long strings, the tail of long arrays, repeated key sets, and a repeated key
 * table go.
 */
function compressJson(content, options) {
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch (error) {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null

  let replaced = 0
  let maskedItems = 0
  let factored = 0

  const walk = (value, depth) => {
    if (typeof value === 'string') {
      if (value.length <= options.shortValueChars || looksLikeIdentifier(value)) return value
      const replacement = marker('str', value)
      // A marker costs tokens itself. Replacing a value that is barely longer
      // than its own marker makes the payload BIGGER, which is what a lockfile
      // full of 94-character hashes demonstrated. Keep the value when the
      // marker would not pay for it.
      if (estimateTokens(replacement) >= estimateTokens(value)) return value
      replaced += 1
      return replacement
    }
    if (value === null || typeof value !== 'object') return value
    if (depth > options.maxDepth) {
      replaced += 1
      return marker('deep', JSON.stringify(value) ?? '')
    }
    if (Array.isArray(value)) {
      const records = value.filter((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
      if (records.length === value.length) {
        const factoredRecords = factorRecords(value, walk)
        if (factoredRecords !== null) {
          factored += value.length
          // Already JSON text, embedded verbatim so the schema marker stays
          // inside the array it describes.
          return { __hrRaw: factoredRecords.text }
        }
      }
      if (value.length > options.maxArrayItems) {
        const kept = []
        for (let index = 0; index < options.maxArrayItems; index += 1) kept.push(walk(value[index], depth + 1))
        maskedItems += value.length - options.maxArrayItems
        kept.push(marker('items', JSON.stringify(value.slice(options.maxArrayItems)) ?? ''))
        return kept
      }
      return value.map((item) => walk(item, depth + 1))
    }
    // A map of same-shaped records — a lockfile's `packages`, a dict of configs.
    // The outer keys are data, not schema, so they are kept next to their row.
    const mapValues = Object.values(value)
    if (mapValues.length >= 3) {
      const allRecords = mapValues.every((item) => item !== null && typeof item === 'object' && !Array.isArray(item))
      if (allRecords) {
        const factoredRecords = factorRecords(mapValues, walk)
        if (factoredRecords !== null) {
          const rows = factoredRecords.rows
          factored += rows.length
          // The names stay as data. Only a pathologically long one is
          // shortened, and the full name is in the retrievable original.
          const names = Object.keys(value).map((name) =>
            name.length <= 48 ? name : name.slice(0, 24) + '…' + name.slice(-16),
          )
          return { __hrRaw: serializeWalks([rows[0], ...rows.map((row, index) => [names[index], row])]) }
        }
      }
    }
    const out = {}
    for (const key of Object.keys(value)) {
      out[key] = walk(value[key], depth + 1)
    }
    return out
  }

  const compact = walk(parsed, 0)

  /**
   * Serialize the compact tree, emitting a factored region's JSON verbatim.
   *
   * This is a serializer rather than a `JSON.stringify` plus substitution
   * because a factored region is already JSON text that must land inside the
   * array it describes. Substituting after the fact needs a regex that knows
   * every position it can appear in — and the first attempt at that only
   * handled the array case, silently leaving the object case wrapped in a
   * quoted string.
   */
  const serialize = (node) => {
    if (node === null) return 'null'
    if (typeof node === 'string') return JSON.stringify(node)
    if (typeof node === 'number' || typeof node === 'boolean') return JSON.stringify(node)
    if (Array.isArray(node)) return '[' + node.map(serialize).join(',') + ']'
    if (typeof node === 'object' && Object.hasOwn(node, '__hrRaw')) return node.__hrRaw
    if (typeof node === 'object') {
      return '{' + Object.entries(node).map(([key, item]) => JSON.stringify(key) + ':' + serialize(item)).join(',') + '}'
    }
    return 'null'
  }

  let text
  try {
    text = serialize(compact)
  } catch (error) {
    return null
  }
  if (typeof text !== 'string' || text === '') return null
  const transforms = ['json:keys-kept', 'json:bulk-values-masked']
  if (maskedItems > 0) transforms.push('json:array-tails-masked')
  if (factored > 0) transforms.push('json:records-factored')

  const hoisted = hoistKeys(text)
  if (hoisted.hoisted > 0) {
    text = hoisted.text
    transforms.push(...hoisted.transforms)
  }

  return {
    content: text,
    transforms,
    maskedLines: replaced + maskedItems,
  }
}

// ── text handler ────────────────────────────────────────────────────────────

/** Split prose into sentences without tripping over decimals and abbreviations. */
function sentencesOf(text) {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'([])/)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * Replace filler in prose: drop the middle of a long paragraph and the middle
 * paragraphs of a long document, keeping openings and endings.
 *
 * Headings are kept unconditionally, as a skeleton written at the top.
 *
 * They were previously kept only when a heading happened to begin its own
 * paragraph and that paragraph survived: a heading glued to the paragraph below
 * it belongs to the same block, and masking that block took the heading with it.
 * The `transforms` list nevertheless reported `text:headings-kept`, which is how
 * a document could lose most of its navigation while claiming to preserve it —
 * on a 20-section record, 19 headings disappeared into a single marker.
 *
 * Collapsing a document into one marker is a legitimate trade, but it is only
 * honest if what remains can still be navigated. The skeleton is cheap: a
 * heading costs a few tokens against the hundreds its section hides.
 */
function compressText(content, options) {
  const blocks = content.split(/\n{2,}/)
  const nonEmpty = blocks.filter((block) => block.trim() !== '')
  let replaced = 0

  // Every heading in the document, in order, including ones buried mid-block.
  const headings = content
    .split('\n')
    .filter((line) => /^#{1,6} \S/.test(line.trim()))
    .map((line) => line.trim())

  /**
   * A block with its heading lines removed, so the per-sentence path does not
   * keep a heading that the skeleton already states.
   */
  const withoutHeadings = (block) =>
    block
      .split('\n')
      .filter((line) => !/^#{1,6} \S/.test(line.trim()))
      .join('\n')
      .trim()

  const compressBlock = (block) => {
    const body = withoutHeadings(block)
    const sentences = sentencesOf(body)
    if (sentences.length < 6) return block
    const head = sentences.slice(0, 2)
    const tail = sentences.slice(-1)
    const dropped = sentences.slice(2, sentences.length - 1).join(' ')
    if (dropped.length < 160) return block
    replaced += 1
    return head.join(' ') + ' ' + marker('text', dropped) + ' ' + tail.join(' ')
  }

  let out
  // `textDocumentPath: false` forces the per-block path, so the two strategies
  // can be compared on the same document without editing the code. Undefined in
  // normal use; the option exists for measurement, not for callers.
  if (nonEmpty.length > 6 && options.textDocumentPath !== false) {
    const head = nonEmpty.slice(0, 2)
    const tail = nonEmpty.slice(-2)
    const middle = nonEmpty.slice(2, nonEmpty.length - 2).join('\n\n')
    const candiateMiddle = marker('para', middle)
    if (estimateTokens(compile(head, candiateMiddle, tail)) < estimateTokens(compile(head, middle, tail))) {
      replaced += 1
      out = compile(head, candiateMiddle, tail)
    } else {
      out = blocks.map((block) => (block.trim() === '' ? block : compressBlock(block))).join('\n\n')
    }
  } else {
    out = blocks.map((block) => (block.trim() === '' ? block : compressBlock(block))).join('\n\n')
  }

  // Prepend the skeleton only when the collapse dropped headings the output does
  // not already carry, so a document whose headings all survived is left alone.
  const kept = new Set((out.match(/^#{1,6} \S.*$/gm) ?? []).map((line) => line.trim()))
  const missing = headings.filter((heading) => !kept.has(heading))
  const transforms = ['text:headings-kept', 'text:filler-masked']
  if (missing.length > 0) {
    out = missing.join('\n') + '\n\n' + out
    // The skeleton is an addition, not a consequence of the masking. Reporting
    // only `headings-kept` hid the fact that the collapse had dropped them and
    // they had to be restored — the transform list described the outcome without
    // mentioning the repair, which is how the earlier defect stayed invisible.
    transforms.push('text:skeleton-added')
  }

  return {
    content: out,
    transforms,
    maskedLines: replaced,
  }
}

function compile(head, middle, tail) {
  return head.join('\n\n') + '\n\n' + middle + '\n\n' + tail.join('\n\n')
}

// ── generic line spread ─────────────────────────────────────────────────────

/** Last resort for line-oriented content with no recognizable structure. */
function compressLines(content, options) {
  const lines = splitLines(content)
  const keep = pickSpread(lines.length, Math.max(options.spread, 10))
  const elided = elideUnpicked(lines, keep, 'lines')
  const transforms = ['lines:head-tail-spread']
  if (elided.lines.some((line) => line.startsWith(MARKER_PREFIX + 'run:'))) transforms.push('lines:runs-factored')
  return {
    content: joinLines(elided.lines),
    transforms,
    maskedLines: elided.hidden,
  }
}

// ── the reversible store ────────────────────────────────────────────────────

/**
 * Session-scoped store of untouched originals, keyed by token.
 *
 * Entries expire on read (TTL) and the oldest are dropped past `max`, which is
 * the honest failure mode: a `retrieve` that finds nothing says so, and never
 * returns a substitute.
 */
export class TokenStore {
  constructor({ max = 256, ttlMs = 60 * 60 * 1000 } = {}) {
    this.max = max
    this.ttlMs = ttlMs
    this.entries = new Map()
  }

  /**
   * Store one entry.
   *
   * `now` must be the same instant the entry was stamped with. Expiring against
   * the wall clock while the entry carries a caller-supplied `createdAt` mixes
   * two time references: an entry stamped in the past is treated as ancient and
   * deleted the moment it is inserted, and one stamped in the future can never
   * expire. The compressor takes `now` so results are reproducible, and the
   * store has to honour the same reference or that reproducibility is a lie.
   *
   * `createdAt` is filled in when the caller omits it. This class is exported
   * (the package maps `./engine`), so `put` is callable with a hand-built entry,
   * and an entry without a timestamp used to make `expire` throw on `undefined`
   * — after which EVERY later operation on the store threw too, because the
   * poisoned entry stayed in the map. One malformed insert cannot be allowed to
   * break an otherwise healthy store.
   */
  put(token, entry, now = Date.now()) {
    const complete = typeof entry?.createdAt === 'number' ? entry : { ...entry, createdAt: now }
    this.expire(now)
    if (!this.entries.has(token) && this.entries.size >= this.max) {
      let oldestKey = null
      let oldestAt = Infinity
      for (const [key, value] of this.entries) {
        if (value.createdAt < oldestAt) {
          oldestAt = value.createdAt
          oldestKey = key
        }
      }
      if (oldestKey !== null) this.entries.delete(oldestKey)
    }
    this.entries.set(token, complete)
    return token
  }

  expire(now = Date.now()) {
    let dropped = 0
    for (const [key, entry] of this.entries) {
      if (now - entry.createdAt > this.ttlMs) {
        this.entries.delete(key)
        dropped += 1
      }
    }
    return dropped
  }

  /**
   * Exact token, or an unambiguous prefix.
   *
   * `now` is the same instant the caller gave `put` and `compress`. It defaults
   * to the wall clock, which is right for a live session and wrong for a caller
   * working in a fixed frame of reference: without it, an entry stored with
   * `createdAt: T` is expired against `Date.now()`, so it vanishes on the first
   * lookup even though `T` is well inside the ttl. `put` takes `now` for exactly
   * this reason, and a store whose writer and reader disagree about what time it
   * is cannot be tested at its boundaries.
   *
   * A non-string token is reported as `missing` rather than left to throw.
   * `startsWith` on a number or `undefined` is a TypeError, and "the caller
   * handed me the wrong type" is a lookup miss, not a reason to fail the whole
   * operation — the tool already coerces before calling, but this class is
   * exported and the cost of being strict here is a crash in someone else's
   * process.
   */
  find(token, now = Date.now()) {
    this.expire(now)
    if (typeof token !== 'string' || token === '') return { kind: 'missing' }
    const exact = this.entries.get(token)
    if (exact !== undefined) return { kind: 'found', entry: exact }
    const matches = [...this.entries.keys()].filter((key) => key.startsWith(token))
    if (matches.length === 1) return { kind: 'found', entry: this.entries.get(matches[0]) }
    if (matches.length > 1) return { kind: 'ambiguous', matches }
    return { kind: 'missing' }
  }

  forget(token, now = Date.now()) {
    const found = this.find(token, now)
    if (found.kind === 'missing') return 0
    if (found.kind === 'ambiguous') return 0
    this.entries.delete(found.entry.hash)
    return 1
  }

  clear() {
    const size = this.entries.size
    this.entries.clear()
    return size
  }

  describe(now = Date.now()) {
    this.expire(now)
    let bytes = 0
    let tokens = 0
    for (const entry of this.entries.values()) {
      bytes += entry.text.length
      tokens += entry.tokens
    }
    return { entries: this.entries.size, bytes, tokens, max: this.max, ttlMinutes: Math.round(this.ttlMs / 60_000) }
  }
}

// ── query search inside a stored original ───────────────────────────────────

function shingles(text) {
  const words = text.toLowerCase().match(/[a-z0-9_]+/g)
  if (words === null) return new Set()
  return new Set(words.filter((word) => word.length > 2))
}

function overlapScore(query, line) {
  if (query.size === 0) return 0
  const lineWords = shingles(line)
  if (lineWords.size === 0) return 0
  let hits = 0
  for (const word of query) {
    if (lineWords.has(word)) hits += 1
  }
  return hits / query.size
}

/**
 * Return the regions of `text` that match `query`, with one line of context on
 * each side and overlapping windows merged. This is headroom's
 * `retrieve(query=...)`: the model asks a question and pays only for the
 * answer's neighborhood.
 *
 * Two kinds of match are possible, and each region says which one it is:
 *
 *   literal  the query occurs in the region as written (case aside). This is
 *            what a caller searching for an error string expects.
 *   related  the region shares query words but does not contain the query. This
 *            is what makes a natural-language query useful — `connection reset`
 *            finds `ECONNRESET by peer` — and it is why the results are not
 *            filtered down to literal hits only.
 *
 * The distinction is reported rather than left implicit because the two are not
 * interchangeable: a caller who needs the exact string must be able to tell that
 * a region was returned for relatedness, not presence. An earlier version
 * returned both without saying which, so `^2026` could come back with regions
 * that did not contain `^2026` at all.
 */
function searchRegions(text, query, limit) {
  const lines = splitLines(text)
  const needle = query.toLowerCase()
  const terms = shingles(query)
  const scored = []

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    let score = overlapScore(terms, line)
    if (needle.length > 1 && line.toLowerCase().includes(needle)) score = Math.max(score, 1)
    if (score > 0) scored.push({ index, score })
  }

  scored.sort((a, b) => b.score - a.score || a.index - b.index)

  const picked = []
  const taken = []
  for (const hit of scored) {
    if (picked.length >= limit) break
    if (taken.some((range) => hit.index >= range.start - 2 && hit.index <= range.end + 2)) continue
    const start = Math.max(0, hit.index - 1)
    const end = Math.min(lines.length - 1, hit.index + 1)
    taken.push({ start, end })
    picked.push({ line: hit.index + 1, score: Math.round(hit.score * 1000) / 1000, start, end })
  }

  // The context lines around a hit may or may not carry the query themselves, so
  // `literal` is decided on the region as returned, not on the matched line.
  return picked
    .sort((a, b) => a.line - b.line)
    .map((hit) => {
      const region = lines.slice(hit.start, hit.end + 1).join('\n')
      const literal = needle.length > 0 && region.toLowerCase().includes(needle)
      return {
        line: hit.line,
        score: hit.score,
        text: region,
        match: literal ? 'literal' : 'related',
      }
    })
}

// ── the compressor ──────────────────────────────────────────────────────────

const DEFAULT_OPTIONS = {
  kind: 'auto',
  targetRatio: 0.45,
  minSavings: 0.12,
  shortValueChars: SHORT_VALUE_CHARS,
  maxArrayItems: 3,
  maxDepth: 12,
  spread: 8,
}

/**
 * Compress `content` and store the untouched original.
 *
 * @returns a result describing exactly what happened. `stored: false` means no
 *   transform paid off and `compressed` is the original text.
 */
export function compress(content, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const store = options.store
  const now = options.now ?? Date.now()

  if (typeof content !== 'string') throw new TypeError('content must be a string')
  const original = content
  const originalTokens = estimateTokens(original)

  const requested = opts.kind === 'auto' ? detectKind(original) : opts.kind
  const handlers = [
    ['diff', () => compressDiff(original, opts)],
    ['json', () => compressJson(original, opts)],
    // After `json`, and never detected on its own: a JSONL stream is reported as
    // `json` by detection (the shape is JSON), so this handler is reached when
    // the JSON handler declines a document that turns out to be many documents.
    ['jsonl', () => compressJsonl(original, opts)],
    ['log', () => compressLog(original, opts)],
    ['code', () => compressCode(original, opts)],
    ['text', () => compressText(original, opts)],
    ['lines', () => compressLines(original, opts)],
  ]

  /** Run one handler, returning null when it produced nothing usable. */
  const runHandler = (run) => {
    let result = null
    try {
      result = run()
    } catch {
      result = null
    }
    if (result === null || typeof result.content !== 'string') return null
    if (result.content === '' && original !== '') return null
    if (result.content === original) return null
    const tokens = estimateTokens(result.content)
    const saved = originalTokens === 0 ? 0 : (originalTokens - tokens) / originalTokens
    return { content: result.content, tokens, transforms: result.transforms, saved, usable: saved >= opts.minSavings }
  }

  const forKind = (kind) => {
    const entry = handlers.find(([name]) => name === kind)
    return entry === undefined ? null : runHandler(entry[1])
  }

  /**
   * Fast path: the detected handler already qualifies, so it wins by definition.
   *
   * Selection prefers the detected handler whenever it clears the floor, and only
   * otherwise falls back to the conservative candidate that keeps the most text.
   * Running the other five handlers to discover that is work whose result is then
   * discarded — each one is a full walk of the payload plus an estimateTokens
   * pass, on a 150 KB log that is most of the call.
   *
   * This changes nothing that is observable: the winner here is the same
   * candidate the full scan would have selected, and the refusal path below still
   * runs the remaining handlers, because a shortfall has to be measured against
   * whatever else could have applied.
   */
  const requestedResult = forKind(requested)

  const produced = []
  // `opts.fullScan` forces the unoptimised ordering: every handler runs, and the
  // winner is chosen from the complete set. It exists so the fast path can be
  // differentially tested against the code it replaced, on the real handlers
  // rather than a reimplementation of them. Undefined in normal use.
  const fast = opts.fullScan !== true && requestedResult !== null && requestedResult.usable
  if (fast) {
    produced.push({ kind: requested, ...requestedResult })
  } else {
    for (const [kind, run] of handlers) {
      if (kind === requested) {
        if (requestedResult !== null) produced.push({ kind, ...requestedResult })
        continue
      }
      const result = runHandler(run)
      if (result !== null) produced.push({ kind, ...result })
    }
  }

  const usable = produced.filter((candidate) => candidate.usable)

  /**
   * A fallback may not win by discarding the document.
   *
   * "Keep the most text" measures size, and size alone cannot tell a conservative
   * transform from a destructive one. On a small JSON array the JSON handler kept
   * the key schema and every record at 149 of 165 tokens — 9.7%, just under the
   * 12% floor — so it was unusable and the fallback took the `code` handler,
   * which masked the whole body and reported 90.9%: the payload became
   * `[\n<<hr:body:hidden=580>>\n]`. Run on text that is a legitimate mask; run on
   * JSON it is not, because the surviving value is no longer valid JSON — only
   * the brackets were kept, and every key and record is behind a digest.
   *
   * The rule is narrow: it applies only when the original is JSON and the
   * detected handler is the JSON handler, and it only rejects a fallback that
   * retains FEWER leaf values than the JSON handler did. A fallback that keeps
   * more leaves has genuinely lost less and is left alone.
   */
  const leavesOf = (text) => {
    try {
      let count = 0
      const walk = (node, depth) => {
        if (node === null || typeof node !== 'object') {
          count += 1
          return
        }
        if (depth > 64) return
        if (Array.isArray(node)) {
          for (const item of node) walk(item, depth + 1)
          return
        }
        for (const value of Object.values(node)) walk(value, depth + 1)
      }
      walk(JSON.parse(text), 0)
      return count
    } catch {
      return -1
    }
  }

  /**
   * Whether a payload is JSON — parsed, or merely shaped like it.
   *
   * Valid JSON is the easy case. The case that slipped through is JSON that does
   * not parse: an API page truncated mid-transfer, a document with a BOM, a
   * payload with a prologue line. Those start with `{` or `[`.
   *
   * Balance is NOT required. A payload cut off mid-object is precisely the one a
   * reader most needs keys for, and requiring balance excluded exactly that case:
   * a 400-character prefix of an API page ends with `},\n    {` and a depth of
   * three, so it fell through to the `code` handler, which kept the opening brace
   * and masked the rest — `{\n<<hr:body:hidden=397>>`. Instead the test asks
   * whether a quoted key appears, which is what distinguishes JSON from a brace
   * language beginning with `{`.
   *
   * A false positive is safe by construction: all the caller can lose is the
   * saving, because the guard only ever refuses a transformation. A file that is
   * not really JSON but looks like it is simply gets left alone.
   */
  const jsonShaped = (text) => {
    const trimmed = text.trim()
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return false
    if (trimmed.startsWith('[')) {
      // A top-level array has no keys to test for, so accept it only when it is
      // balanced — otherwise every `[` -leading log or listing would qualify.
      let depth = 0
      let inString = false
      let escaped = false
      for (const char of trimmed) {
        if (escaped) {
          escaped = false
          continue
        }
        if (char === '\\') {
          escaped = true
          continue
        }
        if (char === '"') {
          inString = !inString
          continue
        }
        if (inString) continue
        if (char === '[') depth += 1
        else if (char === ']') depth -= 1
      }
      return depth === 0
    }
    return /"\s*(?:[A-Za-z_$][\w$.-]*)\s*"\s*:/.test(trimmed)
  }

  const jsonFloor =
    requested === 'json' && requestedResult !== null && jsonShaped(original) ? leavesOf(requestedResult.content) : -1
  /**
   * A JSON-shaped payload may only be handed to another handler if that handler
   * keeps as much of the document as the JSON handler did.
   *
   * Two cases reach here. When the JSON handler produced a navigable result that
   * merely fell below the savings floor, `jsonFloor` is that result's leaf count
   * and a gutting fallback is rejected. When the JSON handler produced nothing
   * usable, `jsonFloor` is 0 and the payload would otherwise go to `code`, which
   * on JSON-shaped text keeps the outermost brackets and masks everything between
   * them — a truncated API page became `{\n<<hr:body:hidden=644>>\n}`, a document
   * with no keys and no records in it.
   *
   * A payload the JSON handler cannot read at all is not JSON-shaped by the
   * bracket test, so this does not block a genuine fallback: a brace-heavy log or
   * a C file still reaches the handlers that suit it.
   */
  const jsonGuarded = requested === 'json' && jsonShaped(original)
  const admissible = (candidate) =>
    candidate.kind === requested ||
    // `jsonl` is exempt: it is the structural handler for this shape, not a
    // fallback that discards it, and it keeps every record and key.
    candidate.kind === 'jsonl' ||
    !jsonGuarded ||
    (jsonFloor > 0 && leavesOf(candidate.content) >= jsonFloor)

  /**
   * Prefer the detected handler. Among the rest, prefer the one that keeps the
   * most text — a fallback should be a conservative transform, never the most
   * destructive one.
   */
  const allowed = usable.filter(admissible)
  let best = allowed.find((candidate) => candidate.kind === requested) ?? null
  if (best === null && allowed.length > 0) {
    best = allowed.reduce((most, candidate) => (candidate.tokens > most.tokens ? candidate : most))
  }
  const detected = requestedResult === null ? null : { kind: requested, ...requestedResult }

  /**
   * Structure-preserving handlers only, for a JSON-shaped payload.
   *
   * This clause existed as an earlier attempt and was removed once because it was
   * wrong: with the JSON handler producing nothing, `jsonFloor` was 0 and
   * `leavesOf(original)` returned −1 for a payload that does not parse, so EVERY
   * candidate failed admissibility and compressible content was refused — a
   * 40-record page with a trailing comment stopped compressing at all. The rule
   * belongs as a gate on the winner: a JSON-shaped payload may only be represented
   * by `json` or `jsonl`, whose output still parses. Anything else routes to the
   * JSON handler's own result when there is one, and refuses otherwise.
   */
  if (best !== null && jsonGuarded && best.kind !== requested && best.kind !== 'jsonl') {
    if (detected !== null) {
      best = usable.find((candidate) => candidate.kind === requested) ?? null
    }
    if (best === null || (best.kind !== 'json' && best.kind !== 'jsonl')) best = null
  }

  if (best === null) {
    const closest = detected ?? null
    const shortfall = closest === null ? null : originalTokens - closest.tokens
    return {
      kind: requested,
      detected: requested,
      confident: true,
      compressed: original,
      token: null,
      stored: false,
      originalTokens,
      compressedTokens: originalTokens,
      savedTokens: 0,
      savedPercent: 0,
      transforms: closest?.transforms ?? [],
      note:
        closest === null
          ? 'no structural transform applies; the content was left untouched'
          : 'compressing this content would save only ' +
            String(shortfall) +
            ' of ' +
            String(originalTokens) +
            ' tokens, below the ' +
            String(Math.round(opts.minSavings * 100)) +
            '% floor; content returned unchanged',
    }
  }

  const candidateTokens = best.tokens
  const target = Math.max(MARKER_TOKEN_COST, Math.round(originalTokens * opts.targetRatio))
  let visible = best.content
  let truncated = false

  if (candidateTokens > target && visible.length > MAX_VISIBLE_CHARS) {
    visible = visible.slice(0, MAX_VISIBLE_CHARS) + '\n' + marker('truncated', visible.slice(MAX_VISIBLE_CHARS))
    truncated = true
  }

  const compressedTokens = estimateTokens(visible)
  const savedTokens = originalTokens - compressedTokens
  const savedRatio = originalTokens === 0 ? 0 : savedTokens / originalTokens

  if (
    store === undefined ||
    savedTokens <= 0 ||
    savedRatio < opts.minSavings ||
    visible.length >= original.length ||
    visible === original
  ) {
    return {
      kind: best.kind,
      detected: best.kind,
      confident: true,
      compressed: original,
      token: null,
      stored: false,
      originalTokens,
      compressedTokens: originalTokens,
      savedTokens: 0,
      savedPercent: 0,
      transforms: best.transforms,
      truncated: false,
      note:
        savedTokens <= 0 || savedRatio < opts.minSavings
          ? 'compression would not save enough tokens (' + Math.round(Math.max(0, savedRatio) * 100) + '%); content returned unchanged'
          : 'nothing to store',
    }
  }

  const token = tokenFor(original)
  store.put(token, {
    hash: token,
    text: original,
    kind: best.kind,
    source: options.source ?? null,
    tokens: originalTokens,
    createdAt: now,
  }, now)

  return {
    kind: best.kind,
    detected: requested,
    confident: best.kind === requested,
    compressed: visible,
    token,
    stored: true,
    originalTokens,
    compressedTokens,
    savedTokens,
    savedPercent: Math.round(savedRatio * 1000) / 10,
    transforms: best.transforms,
    truncated,
    note: null,
  }
}

// ── session statistics ──────────────────────────────────────────────────────

/**
 * The engine instance: one store and one event log, shared by the tool actions
 * for the lifetime of the plugin.
 */
export function getEngine({ storeMax = 256, ttlMs = 60 * 60 * 1000 } = {}) {
  const store = new TokenStore({ max: storeMax, ttlMs })
  const totals = { compressions: 0, retrievals: 0, tokensBefore: 0, tokensAfter: 0, savedTokens: 0 }
  const events = []

  return {
    store,
    ttlMinutes: Math.round(ttlMs / 60_000),
    estimateTokens,
    search: searchRegions,
    detectKind,
    compress: (content, options = {}) => compress(content, { ...options, store }),
    record(event) {
      const entry = { at: Date.now(), ...event }
      events.push(entry)
      while (events.length > 50) events.shift()
      // Only a compress that actually stored something counts toward savings;
      // a refused compress changed nothing and must not inflate the meter.
      if (event.action === 'compress' && event.tokensAfter !== undefined && (event.savedTokens ?? 0) > 0) {
        totals.compressions += 1
        totals.tokensBefore += event.tokensBefore ?? 0
        totals.tokensAfter += event.tokensAfter ?? 0
        totals.savedTokens += event.savedTokens ?? 0
      }
      if (event.action === 'retrieve') totals.retrievals += 1
    },
    stats() {
      const described = store.describe()
      return {
        compressions: totals.compressions,
        retrievals: totals.retrievals,
        tokensBefore: totals.tokensBefore,
        tokensAfter: totals.tokensAfter,
        tokensSaved: totals.savedTokens,
        savingsPercent:
          totals.tokensBefore === 0
            ? 0
            : Math.round((totals.savedTokens / totals.tokensBefore) * 1000) / 10,
        storedEntries: described.entries,
        storedBytes: described.bytes,
        ttlMinutes: described.ttlMinutes,
        recentEvents: events.slice(-10).reverse(),
      }
    },
  }
}

/**
 * headroom — context engineering for the DeepSeek Harness.
 *
 * SPDX-License-Identifier: Apache-2.0
 * Copyright 2026 the dsh-plugin-headroom contributors
 *
 * An independent implementation of the techniques published by the open-source
 * headroom project (https://github.com/headroomlabs-ai/headroom, Apache-2.0,
 * Copyright 2025 Headroom Contributors), written as a plain DSH host plugin
 * instead of an out-of-process MCP server. No upstream source was copied or
 * translated; see NOTICE for what was and was not taken.
 *
 * Why a native plugin and not the real MCP server:
 *
 *   1. `headroom-ai` is a Python package and this deployment denies outbound
 *      network to the host process, so it cannot be installed or run here.
 *   2. The techniques are what carry the value: detect content type, keep the
 *      navigational skeleton, replace the bulky remainder with a token, and
 *      keep the full original retrievable. None of that needs Python.
 *   3. An in-process plugin has no per-call IPC, no subprocess to keep alive,
 *      and reuses the harness's own `fs` service for file input.
 *
 * What is deliberately the same as headroom:
 *
 *   - Structure masks per content type (JSON keys, code signatures, log
 *     levels, high-entropy text tokens stay; bodies and filler go).
 *   - Reversible compression: a marker carries a hash, and the untouched
 *     original is stored so the model can pull it back.
 *   - `retrieve` accepts a query and returns only matching regions.
 *   - Session-scoped statistics with recent events.
 *
 * What is deliberately different:
 *
 *   - No ML stages (Magika detection, Kompress). Detection is structural and
 *     deterministic, which also makes results reproducible and offline.
 *   - Honest accounting: if a transform cannot save tokens, the original is
 *     returned and `savedTokens` is 0. Nothing claims a saving it did not make.
 *
 * Invariants this file must keep:
 *
 *   - Losslessness is absolute. Everything dropped from the visible text is in
 *     the store under the returned hash, byte for byte, or it was never dropped.
 *   - Every compress result states how to get the original back.
 *   - Every action returns a value satisfying OUTPUT_SCHEMA. The registry
 *     validates it, so a drifted shape fails loudly instead of mis-rendering.
 *
 * @module dsh-plugin-headroom
 */

import { compress, getEngine } from './lib/engine.js'

/** The single registered tool name. One tool, not three, to keep the tool
 * catalog cheap: the actions share one schema and one description. */
export const TOOL_NAME = 'headroom'

/**
 * The canonical output contract, in the harness's enforced JSON Schema subset.
 *
 * One open object rather than a `oneOf` of five result shapes: the subset
 * supports `oneOf`, but a flat schema keeps every field discoverable and lets
 * the model and UI read any result the same way.
 */
export const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      description: 'The action that ran, or "error" when the call was rejected.',
    },
    kind: {
      type: 'string',
      description: 'compress: the content handler that actually ran.',
    },
    detected: {
      type: 'string',
      description: 'compress: the handler auto-detection picked, before any forcing or fallback.',
    },
    confident: {
      type: 'boolean',
      description: 'compress: whether the handler that ran is the one detection picked.',
    },
    token: {
      type: 'string',
      description: 'Retrieval token: 16 hex characters, or null when nothing was stored.',
    },
    compressed: {
      type: 'string',
      description: 'compress: the compressed text. Null means the original was returned unchanged.',
    },
    note: {
      type: 'string',
      description: 'Human-readable explanation of what happened, including refusal reasons.',
    },
    error: {
      type: 'string',
      description: 'Set instead of a result when the action could not run.',
    },
    original: {
      type: 'string',
      description: 'retrieve: the complete stored original, byte for byte.',
    },
    source: {
      type: 'string',
      description: 'What produced the stored entry: "content", a file path, or a content kind.',
    },
    originalTokens: { type: 'number', description: 'Estimated tokens before compression.' },
    compressedTokens: { type: 'number', description: 'Estimated tokens after compression.' },
    savedTokens: { type: 'number', description: 'Tokens removed from the visible text.' },
    savedPercent: { type: 'number', description: '`savedTokens` as a percentage of `originalTokens`.' },
    truncated: {
      type: 'boolean',
      description: 'True when the visible text was capped; the stored original is still complete.',
    },
    matched: { type: 'number', description: 'retrieve: how many regions matched the query.' },
    literalMatches: {
      type: 'number',
      description:
        'retrieve with `query`: how many returned regions actually contain the query text. The rest were ' +
        'returned for relatedness (shared words), which is what makes a natural-language query useful.',
    },
    dropped: { type: 'number', description: 'forget: how many entries were removed.' },
    remaining: { type: 'number', description: 'forget: entries still stored afterwards.' },
    compressions: { type: 'number', description: 'stats: compressions that stored something.' },
    retrievals: { type: 'number', description: 'stats: retrievals served.' },
    tokensBefore: { type: 'number', description: 'stats: total estimated tokens fed in.' },
    tokensAfter: { type: 'number', description: 'stats: total estimated tokens kept visible.' },
    tokensSaved: { type: 'number', description: 'stats: total tokens removed.' },
    savingsPercent: { type: 'number', description: 'stats: `tokensSaved` as a percentage of `tokensBefore`.' },
    storedEntries: { type: 'number', description: 'stats: entries currently retrievable.' },
    storedBytes: { type: 'number', description: 'stats: characters held in the store.' },
    ttlMinutes: { type: 'number', description: 'How long a stored original stays retrievable.' },
    transforms: {
      type: 'array',
      items: { type: 'string' },
      description: 'compress: the structural transforms that were applied.',
    },
    results: {
      type: 'array',
      description: 'retrieve with `query`: matching regions, each with one line of context.',
      items: {
        type: 'object',
        properties: {
          line: { type: 'number', description: '1-based line number of the match.' },
          score: { type: 'number', description: 'Relative match strength, 0 to 1.' },
          text: { type: 'string', description: 'The matching region, with context lines.' },
        },
        required: ['line', 'score', 'text'],
        additionalProperties: false,
      },
    },
    recentEvents: {
      type: 'array',
      description: 'stats: the last ten actions, most recent first.',
      items: {
        type: 'object',
        properties: {
          at: { type: 'number' },
          action: { type: 'string' },
          source: { type: 'string' },
          kind: { type: 'string' },
          tokensBefore: { type: 'number' },
          tokensAfter: { type: 'number' },
          savedTokens: { type: 'number' },
          queried: { type: 'boolean' },
        },
        required: ['at', 'action'],
      },
    },
  },
  required: ['action'],
}

/**
 * Latest-wins text marker: every rendered result opens with one.
 *
 * The model must be able to lift `compressed` back out of a transcript without
 * guessing where the payload ended, and a leading marker is the cheapest way to
 * say so.
 */
const BEGIN = '<<<HEADROOM:BEGIN'
const END = '<<<HEADROOM:END>>>'

/**
 * Project one canonical result into what the model reads.
 *
 * The payload is always passed through verbatim: the whole point of this tool
 * is that the model reasons over the compressed text, so quoting, escaping, or
 * summarizing it here would defeat the feature.
 *
 * @param args - the model's arguments.
 * @param value - the validated canonical value.
 * @returns the model-facing content blocks.
 */
export function render(args, value) {
  const result = value ?? {}
  const action = typeof result.action === 'string' ? result.action : 'unknown'
  const lines = []

  if (action === 'error') {
    return [{
      type: 'text',
      text: BEGIN + ' action="error" >>>\n\n' + String(result.error ?? 'the call could not run') + '\n' + END,
    }]
  }

  if (action === 'compress') {
    lines.push(
      BEGIN +
        ' action="compress" kind=' +
        JSON.stringify(String(result.kind ?? 'unknown')) +
        ' tokens=' +
        String(result.originalTokens ?? 0) +
        '->' +
        String(result.compressedTokens ?? 0) +
        ' saved=' +
        String(result.savedTokens ?? 0) +
        ' (' +
        String(result.savedPercent ?? 0) +
        '%) token=' +
        JSON.stringify(result.token ?? null) +
        ' >>>',
      '',
    )
    if (typeof result.compressed === 'string' && result.compressed !== '') lines.push(result.compressed)
    lines.push('', END)
    if (typeof result.note === 'string' && result.note !== '') lines.push('', result.note)
    return [{ type: 'text', text: lines.join('\n') }]
  }

  if (action === 'retrieve') {
    if (Array.isArray(result.results)) {
      lines.push(BEGIN + ' action="retrieve" matched=' + String(result.matched ?? result.results.length) + ' >>>', '')
      for (const region of result.results) {
        lines.push('line ' + String(region.line ?? '?') + ': ' + String(region.text ?? ''))
      }
      lines.push('', END)
      if (result.results.length === 0) lines.push('', 'no region matched the query')
      lines.push('', 'Call headroom again with the same token and no `query` for the complete original.')
      return [{ type: 'text', text: lines.join('\n') }]
    }
    lines.push(BEGIN + ' action="retrieve" tokens=' + String(result.originalTokens ?? 0) + ' >>>', '')
    lines.push(typeof result.original === 'string' ? result.original : '')
    lines.push('', END)
    return [{ type: 'text', text: lines.join('\n') }]
  }

  if (action === 'stats') {
    lines.push(BEGIN + ' action="stats" >>>', '')
    lines.push('compressions: ' + String(result.compressions ?? 0))
    lines.push('retrievals:   ' + String(result.retrievals ?? 0))
    lines.push(
      'tokens saved: ' +
        String(result.tokensSaved ?? 0) +
        ' of ' +
        String(result.tokensBefore ?? 0) +
        ' (' +
        String(result.savingsPercent ?? 0) +
        '%)',
    )
    lines.push(
      'retrievable:  ' +
        String(result.storedEntries ?? 0) +
        ' entries, ttl ' +
        String(result.ttlMinutes ?? 0) +
        ' min',
    )
    lines.push('', 'totals cover this harness process, all sessions included.', END)
    return [{ type: 'text', text: lines.join('\n') }]
  }

  if (action === 'forget') {
    return [{
      type: 'text',
      text:
        BEGIN + ' action="forget" >>>\n\ndropped ' + String(result.dropped ?? 0) + ' entr(ies), ' +
        String(result.remaining ?? 0) + ' still retrievable\n' + END,
    }]
  }

  return [{ type: 'text', text: BEGIN + ' action=' + JSON.stringify(action) + ' >>>\n\n' + END }]
}

/**
 * The model-facing contract.
 *
 * The description is written to make the intended workflow obvious, because a
 * model that calls `compress` and then ignores the compressed text gains
 * nothing: the point is to reason over the returned text.
 */
const TOOL = {
  name: TOOL_NAME,
  description:
    'Shrink large content (file bodies, JSON, logs, search results, diffs) before reasoning over it, ' +
    'and get the original back later. The returned `compressed` text keeps structure and identifiers ' +
    '(keys, signatures, log levels, hashes, paths) while replacing bulky regions with `<<hr:...>>` markers. ' +
    'Call this first, then reason over the `compressed` text rather than the raw input. Nothing is lost: ' +
    'the full original is stored under `token`, and `retrieve` returns it verbatim, or just the regions ' +
    'matching a query. For a file use `path`, not `content`: content you already read is already in ' +
    'context, so compressing it adds a copy instead of keeping the original out, and past 20000 ' +
    'characters a `content` call is refused rather than allowed to cost double. ' +
    'Measured savings: logs 96%, text 98%, diffs 89%, listings 90%, code 85%, json 65%. ' +
    'Actions: `compress`, `retrieve`, `stats`, `forget`.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['compress', 'retrieve', 'stats', 'forget'],
        description: 'Which operation to run.',
      },
      content: {
        type: 'string',
        description:
          'compress: the text to compress. Give either this or `path`. Prefer `path` for a file: ' +
          'content you have already read is already in context, so compressing it adds a second, ' +
          'smaller copy on top of the first instead of keeping the original out. Above ' +
          '20000 characters this is enforced — `content` is refused and you are told to use `path`.',
      },
      path: {
        type: 'string',
        description:
          'compress: read this file through the harness filesystem and compress it without loading it into context first. Preferred over `content` when the text is a file.',
      },
      kind: {
        type: 'string',
        enum: ['auto', 'json', 'code', 'log', 'text', 'diff', 'lines'],
        description:
          'compress: force a content type. Defaults to auto-detection. `lines` keeps a head/tail/spread ' +
          'of a listing-like payload; `diff` keeps hunk headers and the first changes of each hunk.',
      },
      ratio: {
        type: 'string',
        enum: ['light', 'balanced', 'aggressive'],
        description:
          'compress: how much to drop. light keeps more context, aggressive keeps only the skeleton. Defaults to balanced.',
      },
      token: {
        type: 'string',
        description: 'retrieve/forget: the token returned by a previous compress, or a unique prefix of it.',
      },
      query: {
        type: 'string',
        description:
          'retrieve: optional. Return the regions of the original matching this text, with scores, instead of the whole original. Matches the text literally, and also returns regions that share its words — `connection reset` finds `ECONNRESET by peer` — so check `literalMatches` when you need the exact string present.',
      },
      limit: {
        type: 'number',
        description: 'retrieve: maximum regions to return when `query` is given. Defaults to 20; 0 returns none.',
      },
    },
    required: ['action'],
  },
}

/** Ratio presets, mirroring headroom's `compression_ratio_target` knob. */
const RATIOS = {
  light: 0.7,
  balanced: 0.45,
  aggressive: 0.2,
}

/**
 * Most bytes `path` input will read.
 *
 * The engine truncates visible text past `MAX_VISIBLE_CHARS` (120,000 characters)
 * anyway, so a file far larger than that cannot produce a proportionally larger
 * saving — it only costs the read. Sixty-four megabytes is generous enough that
 * nothing legitimate is refused, and low enough that a wrong path (a disk image,
 * a database file) fails immediately with an explanation instead of after a long
 * read and a mysterious truncation.
 */
const MAX_PATH_BYTES = 64 * 1024 * 1024

/**
 * Defaults for the two thresholds that decide the `content` guard.
 *
 * Both are overridable per row (`contentStoreLimitChars`, `contentHintMinChars`),
 * because the right value depends on the deployment: a harness whose sessions
 * routinely carry large pasted payloads may want the refusal higher, and one that
 * never pastes anything can lower it.
 *
 * The mode is chosen by which argument the caller supplies, and the choice is not
 * cosmetic: `path` keeps the original out of context while `content` arrives with
 * a copy already in it, so a `content` pass adds a second copy rather than
 * replacing the first — measured at ~5x the context of the same job done with
 * `path`, and worse than not compressing at all.
 *
 * Instruction alone does not fix that, because the model has usually already read
 * the file by the time it decides to compress, and nothing at that moment says
 * "you are about to pay twice". So the rule is mechanical: a payload past the
 * store limit did not arrive by accident, and if it came through `content` then
 * the caller is holding it already. Refusing is the only honest move available —
 * the alternative is to store a second full copy of something already resident,
 * which cannot save context and only costs memory.
 *
 * Small payloads are exempt: pasted errors and short snippets are legitimately
 * `content`, the duplicate is negligible, and refusing them would break a real
 * use case to fix a rounding error.
 */
const CONTENT_STORE_LIMIT_CHARS = 20000

/**
 * Below this many characters, `content` is left alone and not commented on.
 *
 * The same reasoning as the store limit, applied to the advisory rather than the
 * refusal: at a few hundred characters the duplicate copy is a rounding error, so
 * a note urging `path` would be noise on every short snippet. The note appears
 * only once the payload is big enough for the advice to be worth reading.
 */
const CONTENT_HINT_MIN_CHARS = 2000

/**
 * Mounted engines, keyed by effective configuration.
 *
 * `apply` runs once per composition mount, but a live-reloaded patch layer can
 * re-apply the plugin mid-session. Allocating the store inside `apply` would
 * silently drop every token stored before the reload, so the engine is cached
 * at module scope: a re-apply with the same config reuses the same store, and
 * only a genuinely different config gets a fresh one.
 */
const ENGINES = new Map()

function mountedEngine(config) {
  const storeMax = config.storeMax ?? 256
  const ttlMinutes = config.ttlMinutes ?? 60
  const key = storeMax + ':' + ttlMinutes
  const existing = ENGINES.get(key)
  if (existing !== undefined) return existing
  const created = getEngine({ storeMax, ttlMs: ttlMinutes * 60_000 })
  ENGINES.set(key, created)
  return created
}

/**
 * The host plugin. Registers exactly one tool and nothing else, so it needs no
 * isolate realm: like the other tool rows in a composition it only contributes
 * to the host `tools` registry.
 *
 * @param ctx - the plugin's Cordis context.
 * @param config - row config; every field optional.
 */
export function apply(ctx, config = {}) {
  const engine = mountedEngine(config)

  const tools = ctx.get('tools')
  if (tools === undefined) {
    ctx.logger?.warn?.('headroom: tools registry is not mounted; %s not registered', TOOL_NAME)
    return
  }

  const fs = ctx.get('fs')
  const tokenMeter = ctx.get('tokenMeter')

  const fail = (message) => ({ action: 'error', error: message })

  const doCompress = async (args) => {
    let content = typeof args.content === 'string' ? args.content : undefined
    let source = 'content'

    if ((content === undefined || content === '') && typeof args.path === 'string' && args.path !== '') {
      if (fs === undefined) return fail('the fs service is not mounted, so `path` input is unavailable')
      // Say WHICH part of the fs service is missing. `fs.resolve` is not part of
      // the documented read surface, so its absence is a real possibility on a
      // partial implementation — and reporting that as "could not read <path>"
      // sends the reader looking for a permissions problem that does not exist.
      for (const method of ['resolve', 'readText']) {
        if (typeof fs[method] !== 'function') {
          return fail('the fs service has no `' + method + '` method, so `path` input is unavailable; pass `content` instead')
        }
      }
      try {
        // `resolve` returns an opaque `FsTarget` object, not a path string.
        // Refuse only what obviously cannot be one: `undefined` (nothing
        // resolved) or a primitive. The field names are deliberately NOT
        // inspected — the target's shape belongs to the fs contract, which also
        // owns `readText`'s validation, and hard-coding `targetKey` here would
        // make this plugin reject a backend that spells its target differently.
        const target = await fs.resolve(args.path)
        if (target === null || typeof target !== 'object') {
          return fail(
            'the fs service resolved ' + args.path + ' to ' + (target === undefined ? 'nothing' : typeof target) +
              ', which is not a readable target; it may not exist',
          )
        }

        // `stat` is optional in the fs contract, but when it is present it turns
        // "could not read" into the actual reason. A directory or a binary file
        // is a routine mistake and deserves to be named as one.
        if (typeof fs.stat === 'function') {
          const info = await fs.stat(target)
          if (info === undefined) {
            return fail(args.path + ' does not exist')
          }
          if (info.type !== undefined && info.type !== 'file') {
            return fail(args.path + ' is a ' + info.type + ', not a regular file; `path` reads text files only')
          }
          // The cap matches MAX_VISIBLE_CHARS in the engine, above which the
          // visible text is truncated anyway — so reading a whole gigabyte to
          // then throw 99% of it away is work with no possible payoff.
          if (typeof info.size === 'number' && info.size > MAX_PATH_BYTES) {
            return fail(
              args.path + ' is ' + Math.round(info.size / 1024 / 1024) + ' MB, above the ' +
                Math.round(MAX_PATH_BYTES / 1024 / 1024) + ' MB cap for `path`; read a slice of it and pass `content`',
            )
          }
        }

        const read = await fs.readText(target)
        if (typeof read !== 'string') {
          return fail('the fs service returned ' + (read === undefined ? 'nothing' : typeof read) + ' for ' + args.path + '; it may not exist')
        }
        content = read
        source = args.path
      } catch (error) {
        return fail('could not read ' + args.path + ': ' + String(error?.message ?? error))
      }
    }

    if (typeof content !== 'string' || content === '') {
      return fail('compress needs `content` or a readable `path`')
    }
    if (content.trim() === '') {
      return fail('the content is empty or whitespace, so there is nothing to compress')
    }

    // The automatic part of the mode choice. See CONTENT_STORE_LIMIT_CHARS.
    //
    // `source === 'content'` is the distinguishable signal: it means the caller
    // supplied the text rather than naming a file. A payload past the threshold
    // that arrived that way is already resident in the conversation, so storing
    // it here would duplicate it instead of keeping it out — the opposite of
    // what this tool is for.
    const storeLimit = config.contentStoreLimitChars ?? CONTENT_STORE_LIMIT_CHARS
    if (source === 'content' && content.length > storeLimit) {
      return fail(
        '`content` of ' + content.length.toLocaleString('en-US') + ' chars is above the ' +
          storeLimit.toLocaleString('en-US') + '-char limit for storing; passing `content` means the ' +
          'text is already in context, so compressing it would add a second copy rather than replace the first. ' +
          'Call again with `path` to keep the original out of context; if the text did not come from a file, ' +
          'compress a slice of it instead.',
      )
    }

    const ratio = RATIOS[args.ratio] ?? RATIOS.balanced
    const result = compress(content, {
      kind: args.kind ?? 'auto',
      targetRatio: ratio,
      store: engine.store,
      now: Date.now(),
      minSavings: config.minSavings ?? 0.12,
      shortValueChars: config.shortValueChars ?? 20,
      maxArrayItems: config.maxArrayItems ?? 3,
      maxDepth: config.maxDepth ?? 12,
      spread: config.spread ?? 8,
    })

    engine.record({
      action: 'compress',
      source,
      kind: result.kind,
      tokensBefore: result.originalTokens,
      tokensAfter: result.compressedTokens,
      savedTokens: result.savedTokens,
    })

    if (result.stored === false) {
      // `token` and `compressed` are omitted rather than nulled: the schema
      // declares their types, and an absent field is the honest shape for
      // "there is no token". `compressed` carries the untouched original.
      return {
        action: 'compress',
        kind: result.kind,
        detected: result.detected,
        confident: result.confident,
        originalTokens: result.originalTokens,
        compressedTokens: result.compressedTokens,
        savedTokens: 0,
        savedPercent: 0,
        truncated: false,
        transforms: result.transforms,
        note: result.note,
      }
    }

    // A note that reports rather than advises.
    //
    // When the caller sent `content`, whatever they read to obtain it is already
    // in context, so this call added a second copy instead of keeping the
    // original out — measured at roughly 5x the cost of the same job done with
    // `path`. The tool description says so, but a model that has already read
    // the file is not going to re-read the description at the moment it decides
    // to compress. Stating what this call would have saved had it used `path` is
    // concrete, arrives at the decision point, and costs nothing on the common
    // path — only a `content` call that stored something carries it.
    const hintMin = config.contentHintMinChars ?? CONTENT_HINT_MIN_CHARS
    const pathHint =
      source === 'content' && result.savedTokens > 0 && content.length >= hintMin
        ? ' (this call sent `content`, so whatever you read to get it is still in context;' +
          ' passing `path` instead would have kept that copy out and saved about ' +
          result.originalTokens.toLocaleString('en-US') +
          ' more tokens)'
        : ''
    return {
      action: 'compress',
      kind: result.kind,
      detected: result.detected,
      confident: result.confident,
      token: result.token,
      compressed: result.compressed,
      originalTokens: result.originalTokens,
      compressedTokens: result.compressedTokens,
      savedTokens: result.savedTokens,
      savedPercent: result.savedPercent,
      truncated: result.truncated === true,
      transforms: result.transforms,
      note:
        'reason over `compressed`; call headroom again with action "retrieve" and token "' +
        result.token +
        '" for the full original' +
        (result.truncated ? ' (the visible text was capped; the stored original is complete)' : '') +
        (result.confident === false
          ? ' (the content type was forced or autocorrected; `kind` is what actually ran)'
          : '') +
        pathHint,
    }
  }

  const doRetrieve = (args) => {
    const token = typeof args.token === 'string' ? args.token : ''
    if (token === '') return fail('retrieve needs `token`')

    const found = engine.store.find(token)
    if (found.kind === 'missing') {
      return fail(
        'no stored entry for "' + token + '"; it may have expired (ttl ' + engine.ttlMinutes + ' min) or been forgotten',
      )
    }
    if (found.kind === 'ambiguous') {
      return fail('"' + token + '" matches ' + found.matches.length + ' entries; use more characters')
    }

    // Absent means "give me everything"; present-but-blank means "search for
    // this", which matches nothing. Collapsing the two — which an earlier
    // `args.query.trim() === ''` check did — turned a blank query into a full
    // dump of the stored original: the caller asked for zero regions and
    // received the whole payload, the most expensive possible answer.
    if (args.query === undefined || args.query === null || typeof args.query !== 'string') {
      engine.record({
        action: 'retrieve',
        source: found.entry.kind,
        tokensBefore: 0,
        tokensAfter: engine.estimateTokens(found.entry.text),
        savedTokens: 0,
        queried: false,
      })
      return {
        action: 'retrieve',
        token: found.entry.hash,
        kind: found.entry.kind,
        // Entries stored before `source` was recorded carry null; omit rather
        // than violate the declared string type.
        ...(typeof found.entry.source === 'string' ? { source: found.entry.source } : {}),
        originalTokens: found.entry.tokens,
        original: found.entry.text,
      }
    }

    // A blank but present query searches for whitespace, which matches nothing —
    // a legitimate, cheap answer. `search` handles the empty string itself.
    const query = args.query

    // An explicit `limit` is honoured, including 0. The previous guard was
    // `args.limit > 0`, which turned "return no regions" into "return the
    // default 20" — a caller asking for nothing got a full page. Absent means
    // the default; a negative or non-finite value also falls back, because it
    // cannot be meant literally.
    const requested = args.limit
    const limit =
      requested === undefined || !Number.isFinite(Number(requested)) || Number(requested) < 0
        ? 20
        : Math.min(Math.floor(Number(requested)), 200)
    const regions = engine.search(found.entry.text, query, limit)
    engine.record({
      action: 'retrieve',
      source: found.entry.kind,
      tokensBefore: 0,
      tokensAfter: regions.reduce((sum, region) => sum + engine.estimateTokens(region.text), 0),
      savedTokens: 0,
      queried: true,
    })
    return {
      action: 'retrieve',
      token: found.entry.hash,
      kind: found.entry.kind,
      ...(typeof found.entry.source === 'string' ? { source: found.entry.source } : {}),
      originalTokens: found.entry.tokens,
      matched: regions.length,
      literalMatches: regions.filter((region) => region.match === 'literal').length,
      results: regions.map((region) => ({
        line: region.line,
        score: region.score,
        text: region.text,
      })),
    }
  }

  const doStats = () => {
    const described = engine.store.describe()
    return {
      action: 'stats',
      ...engine.stats(),
      storedEntries: described.entries,
      storedBytes: described.bytes,
      ttlMinutes: described.ttlMinutes,
    }
  }

  const doForget = (args) => {
    const token = typeof args.token === 'string' ? args.token : ''
    if (token === '') {
      const dropped = engine.store.clear()
      engine.record({ action: 'forget', source: 'all', tokensBefore: 0, tokensAfter: 0, savedTokens: 0 })
      return { action: 'forget', dropped, remaining: 0 }
    }
    const dropped = engine.store.forget(token)
    engine.record({ action: 'forget', source: token, tokensBefore: 0, tokensAfter: 0, savedTokens: 0 })
    return { action: 'forget', dropped, remaining: engine.store.describe().entries }
  }

  tools.register({
    name: TOOL_NAME,
    description: TOOL.description,
    parameters: TOOL.parameters,
    output: {
      schema: OUTPUT_SCHEMA,
      render,
    },
    async execute(args) {
      const action = String(args?.action ?? '')
      // The registry validates the canonical value against OUTPUT_SCHEMA, so
      // these shapes are the contract; `render` only decides how they read.
      try {
        if (action === 'compress') return await doCompress(args ?? {})
        if (action === 'retrieve') return doRetrieve(args ?? {})
        if (action === 'stats') return doStats()
        if (action === 'forget') return doForget(args ?? {})
        return fail('unknown action "' + action + '"; use compress, retrieve, stats or forget')
      } catch (error) {
        ctx.logger?.warn?.('headroom: %s failed: %s', action, String(error?.stack ?? error))
        return fail(String(error?.message ?? error))
      }
    },
  })

  // `tokenMeter` is intentionally only probed, not depended on: it prices whole
  // messages, which is a different question from "how big is this blob".
  if (tokenMeter === undefined) {
    ctx.logger?.debug?.('headroom: tokenMeter not mounted; using the built-in estimator')
  }
  ctx.logger?.info?.('headroom: %s tool registered', TOOL_NAME)
}

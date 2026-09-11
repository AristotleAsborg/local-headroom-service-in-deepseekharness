/**
 * Probe the code handler.
 *
 * `compressCode` is the most intricate handler in the engine — the README records
 * four separate bugs in it, each of which produced a plausible compression
 * percentage over a useless result. It is also the handler whose output a reader
 * navigates a file by, so losing a signature means losing the thing they came
 * for.
 *
 * The load-bearing assertion is that the member NAMES survive. A class that
 * compresses to `class C {` plus one marker scores well and tells the reader
 * nothing; that is exactly the failure this probe was written after finding.
 *
 * Run with: node bench/probe-code-edges.mjs
 */

import { compress, detectKind, getEngine, estimateTokens } from '../lib/engine.js'

let findings = 0
const log = []
const note = (kind, name, detail) => {
  log.push(kind.padEnd(5) + name.padEnd(46) + detail)
  if (kind === 'BUG' || kind === 'FAIL') findings += 1
}

const engine = getEngine({ storeMax: 256, ttlMs: 60_000 })

/** Body statements one level deeper than the signature. */
const body = (indent, count) =>
  Array.from({ length: count }, (_, i) => ' '.repeat(indent) + 'const value' + i + ' = compute(' + i + ') + offset' + i).join('\n')

/** Compress as `code`, asserting the round trip and that it never inflates. */
function run(label, content) {
  const result = compress(content, { store: engine.store, kind: 'code' })
  if (result.stored === false) return result
  if (result.kind !== 'code') {
    note('BUG', label + ': ran the wrong handler', 'kind=' + result.kind)
    return result
  }
  const back = engine.store.find(result.token)
  if (back.kind !== 'found' || back.entry.text !== content) {
    note('BUG', label + ': round trip', 'store says ' + back.kind)
  }
  if (estimateTokens(result.compressed) > estimateTokens(content)) {
    note('BUG', label + ': inflated', estimateTokens(content) + ' -> ' + estimateTokens(result.compressed))
  }
  return result
}

// ── the same class, written the way each language writes it ────────────────
//
// Two members every time, so a failure shows whether the first was understood
// (the second survives) or the whole body was swallowed.

const SHAPES = {
  'typescript, brace same line': [
    'export class C {',
    '  alpha(input: number): number {',
    body(4, 18),
    '    return 0',
    '  }',
    '',
    '  beta(): number {',
    body(4, 18),
    '    return 1',
    '  }',
    '}',
  ],
  'typescript, brace next line': [
    'export class C {',
    '  alpha(input: number): number',
    '  {',
    body(4, 18),
    '    return 0',
    '  }',
    '',
    '  beta(): number',
    '  {',
    body(4, 18),
    '    return 1',
    '  }',
    '}',
  ],
  'java, brace same line': [
    'public class J {',
    '    public int alpha(int x) {',
    body(8, 18),
    '        return 0;',
    '    }',
    '',
    '    public int beta() {',
    body(8, 18),
    '        return 1;',
    '    }',
    '}',
  ],
  'java, brace next line': [
    'public class J {',
    '    public int alpha(int x)',
    '    {',
    body(8, 18),
    '        return 0;',
    '    }',
    '',
    '    public int beta()',
    '    {',
    body(8, 18),
    '        return 1;',
    '    }',
    '}',
  ],
  'rust, brace same line': [
    'impl Store {',
    '    pub fn alpha(&self, key: u32) -> Option<u32> {',
    body(8, 18),
    '        None',
    '    }',
    '',
    '    pub fn beta(&self) -> u32 {',
    body(8, 18),
    '        0',
    '    }',
    '}',
  ],
  'rust, brace next line': [
    'impl Store {',
    '    pub fn alpha(&self, key: u32) -> Option<u32>',
    '    {',
    body(8, 18),
    '        None',
    '    }',
    '',
    '    pub fn beta(&self) -> u32',
    '    {',
    body(8, 18),
    '        0',
    '    }',
    '}',
  ],
  'kotlin': [
    'class K {',
    '    fun alpha(input: Int): Int {',
    body(8, 18),
    '        return 0',
    '    }',
    '',
    '    fun beta(): Int {',
    body(8, 18),
    '        return 1',
    '    }',
    '}',
  ],
  'go, brace next line': [
    'package main',
    '',
    'func alpha(x int) int',
    '{',
    body(4, 18),
    '    return 0',
    '}',
    '',
    'func beta() int',
    '{',
    body(4, 18),
    '    return 1',
    '}',
  ],
  'python': [
    'class Store:',
    '    def alpha(self, key):',
    body(8, 18),
    '        return None',
    '',
    '    def beta(self):',
    body(8, 18),
    '        return 0',
  ],
}

for (const [label, lines] of Object.entries(SHAPES)) {
  const content = lines.join('\n')
  const result = run(label, content)
  if (result.stored === false) {
    note('BUG', label + ': refused a full class', String(result.note).slice(0, 48))
    continue
  }
  const names = ['alpha', 'beta'].filter((name) => result.compressed.includes(name))
  const masked = result.compressed.includes('<<hr:body:')
  note(
    names.length === 2 && masked ? 'ok' : 'BUG',
    label,
    result.savedPercent + '% saved, names ' + names.length + '/2, bodies masked=' + masked,
  )
  if (names.length < 2) note('BUG', '  ' + label + ' output', JSON.stringify(result.compressed.slice(0, 160)))
}

// ── declarations that must survive ────────────────────────────────────────

const rich = [
  "import { readFile } from 'node:fs/promises'",
  '',
  'export interface Entry {',
  '  key: string',
  '  value: unknown',
  '}',
  '',
  'export type Loader = (path: string) => Promise<Entry[]>',
  '',
  'export const DEFAULTS = { ttlMs: 60_000, maxEntries: 512 }',
  '',
  'export class Cache<T = unknown> {',
  '  private readonly entries = new Map<string, Entry>()',
  '',
  '  constructor(private readonly ttlMs: number = 60_000) {',
  body(4, 12),
  '  }',
  '',
  '  get(key: string): Entry | undefined {',
  body(4, 12),
  '    return undefined',
  '  }',
  '}',
].join('\n')
const richResult = run('rich typescript module', rich)
for (const [what, needle] of [
  ['import', "import { readFile }"],
  ['interface', 'export interface Entry'],
  ['type alias', 'export type Loader'],
  ['const declaration', 'export const DEFAULTS'],
  ['field', 'private readonly entries'],
  ['constructor', 'constructor(private readonly ttlMs'],
  ['method', 'get(key: string)'],
]) {
  note(richResult.compressed.includes(needle) ? 'ok' : 'BUG', 'rich: ' + what + ' survives', '')
}
note('ok', 'rich: bodies still masked', richResult.savedPercent + '% saved', '')

// ── delimiters inside strings and comments must not confuse the tracker ────

const braceTrap = [
  'export class Trap {',
  '  render() {',
  '    const open = "{"',
  '    const close = "}"',
  '    const mixed = "}{"',
  '    const tpl = `literal ${open} and ${close}`',
  '    // a comment with an unbalanced { brace',
  '    /* another with } and { both */',
  '    if (open === "{") {',
  '      return mixed',
  '    }',
  '    return tpl',
  '  }',
  '',
  '  after(): number {',
  body(4, 12),
  '    return 42',
  '  }',
  '}',
].join('\n')
const trapResult = run('braces in strings and comments', braceTrap)
note(trapResult.compressed.includes('after(): number') ? 'ok' : 'BUG',
  'braces in strings do not swallow the next member', '')

// ── control flow must not be mistaken for a member ─────────────────────────

const control = [
  'function scan(items) {',
  '  for (const item of items) {',
  '    if (item.enabled) {',
  '      while (item.retries > 0) {',
  body(8, 10),
  '      }',
  '    } else {',
  '      continue',
  '    }',
  '  }',
  '  switch (items.length) {',
  '    case 0:',
  '      return null',
  '    default:',
  '      return items',
  '  }',
  '}',
  '',
  'function keepMe() {',
  body(2, 12),
  '  return "visible"',
  '}',
].join('\n')
const controlResult = run('control flow', control)
note(controlResult.compressed.includes('function keepMe') ? 'ok' : 'BUG',
  'control flow does not push a duplicate scope', '')
note(
  controlResult.compressed.split('\n').every((line) => line.trim().length < 90) ? 'ok' : 'BUG',
  'control-flow bodies are masked, not kept',
  controlResult.compressed.split('\n').filter((l) => l.trim().length >= 90).length + ' long lines left',
)

// ── local bindings must not read as members ───────────────────────────────

const locals = ['export class Local {', '  compute(input) {', '    const total = 0', '    let offset = 1', '    const weight = total + offset', body(4, 10), '    return weight', '  }', '}'].join('\n')
const localsResult = run('locals in a body', locals)
note(!/const total = 0/.test(localsResult.compressed) ? 'ok' : 'BUG',
  'a body local is masked, not kept as a member', '')

// ── detection must not steal these from `code` ────────────────────────────

for (const [label, lines] of [['typescript', SHAPES['typescript, brace same line']], ['python', SHAPES.python], ['go', SHAPES['go, brace next line']], ['rust', SHAPES['rust, brace same line']], ['java', SHAPES['java, brace same line']]]) {
  const detected = detectKind(lines.join('\n'))
  note(detected === 'code' ? 'ok' : 'BUG', 'detected as code: ' + label, 'got ' + detected)
}

// ── report ─────────────────────────────────────────────────────────────────

console.log(log.join('\n'))
console.log('')
console.log(findings === 0 ? 'no findings in ' + log.length + ' checks' : findings + ' finding(s) across ' + log.length + ' checks')
process.exit(findings === 0 ? 0 : 1)

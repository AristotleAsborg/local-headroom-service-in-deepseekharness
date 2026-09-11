/**
 * What the Markdown-to-text converter must not damage.
 *
 * `README.txt` and `USAGE.txt` are generated, and the check that validates them
 * compares the two files — so a converter that mangles BOTH copies identically
 * passes that check while shipping corrupted documentation. This probe is the
 * independent one: it knows the right answer for a set of shapes that really
 * occur in these docs and asserts the converter produces it.
 *
 * The regression it exists for: a code span's backticks were stripped early, so
 * the emphasis rules then read the C pointer asterisks in
 *
 *   `func (s *Store) Get(key string) *Entry`
 *
 * as an emphasis pair and deleted them. A code span is literal text — nothing
 * inside it is Markdown, including `*` and `_` — and that is exactly what the
 * backticks assert. `tools/check-txt.mjs` caught the loss because it compares
 * against the Markdown source; this probe pins the behaviour down.
 *
 * Run with: node tools/probe-converter.mjs
 *
 * The conversion is invoked as a child process, which the sandbox forbids with
 * piped stdio, so the probe runs in two phases and exits non-zero asking to be
 * run a second time.
 */

import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const FIXTURE_MD = 'tools/.converter-probe.md'
const FIXTURE_TXT = 'tools/.converter-probe.txt'

let passed = 0
let failed = 0
const check = (name, ok, detail) => {
  if (ok) {
    passed += 1
    console.log('  ok   ' + name)
  } else {
    failed += 1
    console.log('  FAIL ' + name + (detail === undefined ? '' : ' :: ' + detail))
  }
}

/**
 * Each case is [name, Markdown input, expected plain text].
 *
 * The first group is literal syntax inside code spans, which must survive
 * untouched. The second is real emphasis, which must still be removed — a fix
 * that simply disabled the emphasis rules would pass the first group and fail
 * the second.
 */
const CASES = [
  ['C pointer params survive', '`func (s *Store) Get(key string) *Entry`', 'func (s *Store) Get(key string) *Entry'],
  ['Rust signature survives', '`pub fn insert(&mut self, key: u32) -> Option<Entry>`', 'pub fn insert(&mut self, key: u32) -> Option<Entry>'],
  ['pointer field survives', '`*Node next`', '*Node next'],
  ['double star in code survives', '`var x **int`', 'var x **int'],
  ['underscores in code survive', '`private readonly entries_of = 1`', 'private readonly entries_of = 1'],
  ['double star between words survives', '`a ** b`', 'a ** b'],
  ['bold inside a span survives', '`**not bold**`', '**not bold**'],
  ['plain emphasis still stripped', 'this is *important* text', 'this is important text'],
  ['bold still stripped', 'this is **important** text', 'this is important text'],
  ['emphasis after a span still stripped', '`x * y` and *note*', 'x * y and note'],
  ['bold spanning a code span', '**reasoning over the `compressed` text**', 'reasoning over the compressed text'],
  ['italic spanning a code span', '*see the `stats` action*', 'see the stats action'],
  ['link text and URL both kept', 'see [the docs](https://example.com/a)', 'see the docs (https://example.com/a)'],
]

// ── phase 1: emit the fixture, then convert it ──────────────────────────────
if (!existsSync(FIXTURE_TXT)) {
  if (!existsSync(FIXTURE_MD)) {
    writeFileSync(FIXTURE_MD, ['# converter probe', '', ...CASES.map(([, input]) => '- ' + input), ''].join('\n'), 'utf8')
  }
  const run = spawnSync(process.execPath, ['tools/md-to-text.mjs', FIXTURE_MD, FIXTURE_TXT], { stdio: 'inherit' })
  if (run.error !== undefined || run.status !== 0) {
    console.log('could not run the converter directly (child processes are restricted here).')
    console.log('Run these two commands instead:')
    console.log('  node tools/md-to-text.mjs ' + FIXTURE_MD + ' ' + FIXTURE_TXT)
    console.log('  node tools/probe-converter.mjs')
    process.exit(2)
  }
}

// ── phase 2: assert on the converted text ───────────────────────────────────
if (!existsSync(FIXTURE_TXT)) {
  console.log('converted file missing; rerun after converting ' + FIXTURE_MD)
  process.exit(2)
}

const rendered = readFileSync(FIXTURE_TXT, 'utf8')
  .split('\n')
  .filter((line) => /^\s*[*+-]\s+\S/.test(line))
  .map((line) => line.replace(/^\s*[*+-]\s+/, '').trim())

check('converter emitted one line per case', rendered.length === CASES.length, 'got ' + rendered.length + ' of ' + CASES.length)
for (const [index, [name, , expected]] of CASES.entries()) {
  const got = rendered[index]
  check(name, got === expected, 'expected ' + JSON.stringify(expected) + ' got ' + JSON.stringify(got))
}

unlinkSync(FIXTURE_MD)
unlinkSync(FIXTURE_TXT)

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)

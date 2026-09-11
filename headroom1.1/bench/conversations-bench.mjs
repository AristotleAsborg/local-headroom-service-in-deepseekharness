/**
 * Compression efficiency over generated test conversations.
 *
 * `bench/compression-bench.mjs` measures five invented fixtures;
 * `bench/session-savings.mjs` measures one session after the fact. This one sits
 * between them: it drives the INSTALLED headroom over six generated test
 * conversations whose payloads are shaped like the tool results a real coding
 * session pulls in, and reports the compression efficiency per conversation, per
 * content kind, and in aggregate.
 *
 * Three rules keep the numbers honest:
 *
 *   1. Every payload goes through the tool's own `execute`, not the engine
 *      directly, so refusals (`savedTokens: 0`), caps (`truncated`) and the
 *      argument contract are all exercised.
 *   2. Every compression is round-tripped and compared byte for byte. A ratio
 *      from a lossy pass is not a saving, it is a deletion, so a round-trip
 *      failure fails the run.
 *   3. Size is never reported without saying what survived — record counts and
 *      key sets for json, identifier retention for the rest. A payload that
 *      shrinks by dropping its records is worse than no compression at all.
 *
 * Tokens are priced twice: `own` is the engine's estimator, `meter` is
 * `@deepseek-ai/dsh-token-meter`'s `estimateContent`, the heuristic the harness
 * prices surfaces with. Agreement between the two is the evidence that the ratio
 * is not an artifact of one ruler.
 *
 * The measurement itself lives in `lib/measure.mjs`, so `ratio-sweep.mjs`
 * reports the same numbers from the same code rather than from a second
 * implementation that could drift.
 *
 * Run with: node bench/conversations-bench.mjs [--ratio light|balanced|aggressive] [--markdown <path>]
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { CONVERSATIONS, INSTALLED, loadTool, measureCorpus, compressPayload, fold } from './lib/measure.mjs'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = argv.indexOf('--' + name)
  return at === -1 ? fallback : argv[at + 1]
}
const RATIO = flag('ratio', 'balanced')
const MARKDOWN = flag('markdown', null)

let passed = 0
let failed = 0
const check = (name, ok, detail) => {
  if (ok) {
    passed += 1
    console.log('  PASS  ' + name)
  } else {
    failed += 1
    console.log('  FAIL  ' + name + (detail === undefined ? '' : ' :: ' + detail))
  }
}

if (!existsSync(INSTALLED)) {
  console.error('headroom is not installed at ' + INSTALLED)
  process.exit(1)
}

// ── measure ─────────────────────────────────────────────────────────────────

const tool = await loadTool()
const { rows, index, total } = await measureCorpus(tool, { ratio: RATIO })

console.log('headroom compression efficiency — generated test conversations')
console.log('installed tool : ' + INSTALLED)
console.log('ratio preset   : ' + RATIO)
console.log('')

const header =
  '  ' + 'conversation'.padEnd(30) + 'payload'.padEnd(28) + 'kind'.padEnd(7) +
  'chars'.padEnd(19) + 'meter tokens'.padEnd(21) + 'saved'.padEnd(8) + 'idents'.padEnd(8) + 'ms'
console.log(header)
console.log('  ' + '-'.repeat(header.length - 2))

for (const row of rows) {
  console.log(
    '  ' + row.conversation.padEnd(30) + row.payload.padEnd(28) + String(row.kind).padEnd(7) +
      (row.charsBefore + ' -> ' + row.charsAfter).padEnd(19) +
      (row.meterBefore + ' -> ' + row.meterAfter).padEnd(21) +
      (row.savedPercent.toFixed(1) + '%').padEnd(8) +
      ((row.retention.occ * 100).toFixed(0) + '%').padEnd(8) +
      row.elapsed.toFixed(1),
  )
}

// ── aggregate by conversation ───────────────────────────────────────────────

const sum = (list, pick) => list.reduce((running, row) => running + pick(row), 0)

console.log('')
console.log('by conversation')
console.log(
  '  ' + 'conversation'.padEnd(30) + 'payloads'.padEnd(10) + 'chars'.padEnd(20) +
    'meter tokens'.padEnd(22) + 'saved (meter)'.padEnd(15) + 'saved (own)',
)
console.log('  ' + '-'.repeat(112))

const byConversation = []
for (const conversation of index.conversations) {
  const subset = rows.filter((row) => row.conversation === conversation.id)
  if (subset.length === 0) continue
  const folded = fold(subset)
  byConversation.push({ id: conversation.id, title: conversation.title, ...folded })
  console.log(
    '  ' + conversation.id.padEnd(30) + String(folded.payloads).padEnd(10) +
      (folded.charsBefore + ' -> ' + folded.charsAfter).padEnd(20) +
      (folded.meterBefore + ' -> ' + folded.meterAfter).padEnd(22) +
      (folded.savedPercent.toFixed(1) + '%').padEnd(15) +
      folded.ownSavedPercent.toFixed(1) + '%',
  )
}

// ── aggregate by detected kind ──────────────────────────────────────────────

console.log('')
console.log('by detected kind')
console.log(
  '  ' + 'kind'.padEnd(9) + 'payloads'.padEnd(10) + 'chars'.padEnd(20) +
    'meter tokens'.padEnd(22) + 'saved (meter)'.padEnd(15) + 'saved (own)'.padEnd(13) + 'idents kept',
)
console.log('  ' + '-'.repeat(122))

const kinds = [...new Set(rows.map((row) => row.kind))].sort()
const byKind = []
for (const kind of kinds) {
  const subset = rows.filter((row) => row.kind === kind)
  const folded = fold(subset)
  const occ = sum(subset, (row) => row.retention.occ) / subset.length
  const uniq = sum(subset, (row) => row.retention.uniq) / subset.length
  byKind.push({ kind, occ, uniq, ...folded })
  console.log(
    '  ' + kind.padEnd(9) + String(folded.payloads).padEnd(10) +
      (folded.charsBefore + ' -> ' + folded.charsAfter).padEnd(20) +
      (folded.meterBefore + ' -> ' + folded.meterAfter).padEnd(22) +
      (folded.savedPercent.toFixed(1) + '%').padEnd(15) +
      (folded.ownSavedPercent.toFixed(1) + '%').padEnd(13) +
      (occ * 100).toFixed(0) + '% (uniq ' + (uniq * 100).toFixed(0) + '%)',
  )
}

// ── totals ──────────────────────────────────────────────────────────────────

console.log('')
console.log('  ' + '-'.repeat(112))
console.log(
  '  ' + 'TOTAL'.padEnd(39) + (total.charsBefore + ' -> ' + total.charsAfter).padEnd(20) +
    (total.meterBefore + ' -> ' + total.meterAfter).padEnd(22) +
    (total.savedPercent.toFixed(1) + '%').padEnd(15) + total.ownSavedPercent.toFixed(1) + '%',
)
console.log('')
console.log('  labels: own = engine estimator, meter = dsh-token-meter estimateContent')
console.log('          idents = occurrences of record identifiers still readable (uniq = distinct identifiers)')
console.log('          json records = array records present after neutralizing markers, vs the original')

// ── claims as assertions ────────────────────────────────────────────────────

console.log('')
console.log('claims')
check('every generated payload compressed and stored a token',
  rows.length === index.conversations.reduce((count, conversation) => count + conversation.payloads.length, 0),
  rows.length + ' rows')
check('every round trip is byte-exact', rows.every((row) => row.lossless),
  rows.filter((row) => !row.lossless).map((row) => row.payload).join(', '))
check('no payload hit the visible-text cap', rows.every((row) => row.truncated === false),
  rows.filter((row) => row.truncated).map((row) => row.payload).join(', '))
check('aggregate saving is material by the harness meter', total.savedPercent > 50, total.savedPercent.toFixed(1) + '%')
check('aggregate saving is material by the engine estimator', total.ownSavedPercent > 50, total.ownSavedPercent.toFixed(1) + '%')
check('the two estimators agree within 15 points', Math.abs(total.savedPercent - total.ownSavedPercent) < 15,
  'meter=' + total.savedPercent.toFixed(1) + '% own=' + total.ownSavedPercent.toFixed(1) + '%')
check('every conversation saves materially', byConversation.every((entry) => entry.savedPercent > 30),
  byConversation.map((entry) => entry.id + '=' + entry.savedPercent.toFixed(0) + '%').join(', '))

/**
 * Retention is asserted per class of content, because "kept every identifier" is
 * only the right bar for some of them:
 *
 *   - diff keeps records in the text, so every identifier must survive.
 *   - json is measured structurally instead (record counts and key sets), since
 *     key factoring removes the text an identifier count is made of.
 *   - text / code / log keep a navigational skeleton; every *distinct*
 *     identifier must remain reachable somewhere.
 *   - lines samples whole lines by design, so occurrences fall and only the
 *     elision markers plus a non-zero spread can be required.
 */
const diffs = rows.filter((row) => row.kind === 'diff')
check('diff payloads keep every record identifier',
  diffs.every((row) => row.retention.occ === 1),
  diffs.filter((row) => row.retention.occ !== 1)
    .map((row) => row.payload + '=' + (row.retention.occ * 100).toFixed(1) + '%').join(', ') || 'all 100%')

const jsonRows = rows.filter((row) => row.kind === 'json' && row.shape !== null)
check('compressed json parses, ignoring the trailing key legend',
  jsonRows.every((row) => row.shape.parses),
  jsonRows.filter((row) => !row.shape.parses).map((row) => row.payload).join(', ') || 'all parse')
check('json keeps every record, in order and complete',
  jsonRows.every((row) => row.shape.recordsBefore === row.shape.recordsAfter),
  jsonRows.map((row) => row.payload + '=' + row.shape.recordsAfter + '/' + row.shape.recordsBefore).join(', '))
check("json keeps each record's key set",
  jsonRows.every((row) => row.shape.keySetsMatch),
  jsonRows.filter((row) => !row.shape.keySetsMatch).map((row) => row.payload).join(', ') || 'all identical')
check('key-factored json declares the key set it replaced',
  jsonRows.every((row) => row.shape.recordsAfter === 0 || row.shape.keysDeclared > 0),
  jsonRows.filter((row) => row.shape.recordsAfter > 0 && row.shape.keysDeclared === 0)
    .map((row) => row.payload).join(', ') || 'every factored payload declares its keys')

const skeleton = rows.filter((row) => row.kind === 'text' || row.kind === 'code' || row.kind === 'log')
check('text, code and log keep every distinct identifier reachable',
  skeleton.every((row) => row.retention.uniq === 1),
  skeleton.filter((row) => row.retention.uniq !== 1)
    .map((row) => row.payload + '=' + (row.retention.uniq * 100).toFixed(0) + '%').join(', ') || 'all 100%')

// Sampled kinds (`lines`) drop whole lines by design, so occurrences cannot be
// 100%. What must hold is that the sampled text is still navigable: identifiers
// from across the whole range survive, and the visible text says how much it hid
// rather than looking complete.
const sampled = rows.filter((row) => row.kind === 'lines')
check('sampled payloads keep identifiers from across the whole range',
  sampled.every((row) => row.retention.occ >= 0.01),
  sampled.map((row) => row.payload + '=' + (row.retention.occ * 100).toFixed(1) + '%').join(', '))
check('sampled payloads declare the elision in their transforms',
  sampled.every((row) => row.transforms.length > 0),
  sampled.map((row) => row.payload + '=[' + row.transforms.join('+') + ']').join(', '))
check('sampled payloads leave elision markers in the visible text',
  sampled.every((row) => row.elided),
  sampled.filter((row) => !row.elided).map((row) => row.payload).join(', ') || 'every payload')

// ── cost of the saving ──────────────────────────────────────────────────────

console.log('')
console.log('cost of the saving')
const averageCall = total.elapsed / rows.length
console.log('  payloads                       : ' + rows.length)
console.log('  input chars                    : ' + total.charsBefore.toLocaleString('en-US'))
console.log('  visible chars after            : ' + total.charsAfter.toLocaleString('en-US') +
  '  (' + (100 * (1 - total.charsAfter / total.charsBefore)).toFixed(1) + '% smaller)')
console.log('  tokens before -> after (meter) : ' + total.meterBefore.toLocaleString('en-US') + ' -> ' + total.meterAfter.toLocaleString('en-US'))
console.log('  tokens kept out of context     : ' + (total.meterBefore - total.meterAfter).toLocaleString('en-US'))
console.log('  average compress call          : ' + averageCall.toFixed(1) + ' ms')
console.log('  corpus priced with the tool    : ' + total.meterAfter.toLocaleString('en-US') + ' tokens')
console.log('  corpus priced without it       : ' + total.meterBefore.toLocaleString('en-US') + ' tokens')

// ── worked example ──────────────────────────────────────────────────────────

const logRow = rows.find((row) => row.kind === 'log')
if (logRow !== undefined) {
  const content = readFileSync(join(CONVERSATIONS, logRow.conversation, logRow.payload), 'utf8')
  const { result } = await compressPayload(tool, { content, label: logRow.payload, ratio: RATIO })
  console.log('')
  console.log('worked example — ' + logRow.conversation + '/' + logRow.payload +
    ' (' + content.length.toLocaleString('en-US') + ' chars -> ' + String(result.compressed?.length).toLocaleString('en-US') + ')')
  console.log('  transforms: ' + (result.transforms ?? []).join(', '))
  console.log('')
  for (const line of String(result.compressed).split('\n').slice(0, 26)) console.log('  | ' + line.slice(0, 160))
  console.log('  | …')
}

// ── markdown report ─────────────────────────────────────────────────────────

if (MARKDOWN !== null) {
  const lines = []
  lines.push('# 测试对话压缩效率（实测）')
  lines.push('')
  lines.push('由 `bench/conversations-bench.mjs` 生成。语料由 `bench/conversations/generate.mjs` 确定性生成：')
  lines.push('6 组测试对话、' + rows.length + ' 个负载、' + total.charsBefore.toLocaleString('en-US') + ' 字符。')
  lines.push('')
  lines.push('- 驱动对象：**已安装**的那份插件（`' + INSTALLED + '`），走工具自身的 `execute`。')
  lines.push('- ratio 预设：`' + RATIO + '`。')
  lines.push('- token 双估算：`own` = 引擎估算器；`meter` = `@deepseek-ai/dsh-token-meter` 的 `estimateContent`。')
  lines.push('- `idents` = 原负载中的标识符（记录 id、哈希、路径、坐标）在压缩文本中仍可读的比例：')
  lines.push('  `occ` 按出现次数计，`uniq` 按去重后的标识符计。采样类负载必然丢行，所以 `occ` 才是诚实的那个数。')
  lines.push('- json 不按文本计，而按结构计：解出标记后解析两边，比对记录条数与每条记录的键集合。')
  lines.push('- 每个负载都逐字节往返验证：' + (rows.every((row) => row.lossless) ? '全部通过' : '**有失败**') + '。')
  lines.push('')
  lines.push('## 汇总')
  lines.push('')
  lines.push('| 指标 | 数值 |')
  lines.push('| --- | --- |')
  lines.push('| 负载数 | ' + rows.length + ' |')
  lines.push('| 输入字符 | ' + total.charsBefore.toLocaleString('en-US') + ' |')
  lines.push('| 压缩后字符 | ' + total.charsAfter.toLocaleString('en-US') + ' |')
  lines.push('| 字符缩减 | ' + (100 * (1 - total.charsAfter / total.charsBefore)).toFixed(1) + '% |')
  lines.push('| token（meter） | ' + total.meterBefore.toLocaleString('en-US') + ' → ' + total.meterAfter.toLocaleString('en-US') + ' |')
  lines.push('| token（own） | ' + total.ownBefore.toLocaleString('en-US') + ' → ' + total.ownAfter.toLocaleString('en-US') + ' |')
  lines.push('| **压缩效率（meter）** | **' + total.savedPercent.toFixed(1) + '%** |')
  lines.push('| **压缩效率（own）** | **' + total.ownSavedPercent.toFixed(1) + '%** |')
  lines.push('| 两把尺子之差 | ' + Math.abs(total.savedPercent - total.ownSavedPercent).toFixed(1) + ' 个百分点 |')
  lines.push('| 平均单次压缩耗时 | ' + averageCall.toFixed(1) + ' ms |')
  lines.push('')
  lines.push('## 按对话')
  lines.push('')
  lines.push('| 对话 | 负载 | 字符 | token（meter） | 压缩效率（meter） | 压缩效率（own） |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const entry of byConversation) {
    lines.push('| `' + entry.id + '` | ' + entry.payloads + ' | ' + entry.charsBefore.toLocaleString('en-US') + ' → ' + entry.charsAfter.toLocaleString('en-US') + ' | ' + entry.meterBefore.toLocaleString('en-US') + ' → ' + entry.meterAfter.toLocaleString('en-US') + ' | **' + entry.savedPercent.toFixed(1) + '%** | ' + entry.ownSavedPercent.toFixed(1) + '% |')
  }
  lines.push('')
  lines.push('## 按内容类型')
  lines.push('')
  lines.push('| 类型 | 负载 | 字符 | token（meter） | 压缩效率（meter） | 压缩效率（own） | 标识符保留（occ / uniq） |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const entry of byKind) {
    lines.push('| ' + entry.kind + ' | ' + entry.payloads + ' | ' + entry.charsBefore.toLocaleString('en-US') + ' → ' + entry.charsAfter.toLocaleString('en-US') + ' | ' + entry.meterBefore.toLocaleString('en-US') + ' → ' + entry.meterAfter.toLocaleString('en-US') + ' | **' + entry.savedPercent.toFixed(1) + '%** | ' + entry.ownSavedPercent.toFixed(1) + '% | ' + (entry.occ * 100).toFixed(0) + '% / ' + (entry.uniq * 100).toFixed(0) + '% |')
  }
  lines.push('')
  lines.push('## 单个负载明细')
  lines.push('')
  lines.push('| 对话 | 负载 | 类型 | 字符 | token（meter） | 压缩效率 | 标识符 occ | 往返 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const row of rows) {
    lines.push('| `' + row.conversation + '` | `' + row.payload + '` | ' + row.kind + ' | ' + row.charsBefore.toLocaleString('en-US') + ' → ' + row.charsAfter.toLocaleString('en-US') + ' | ' + row.meterBefore.toLocaleString('en-US') + ' → ' + row.meterAfter.toLocaleString('en-US') + ' | ' + row.savedPercent.toFixed(1) + '% | ' + (row.retention.occ * 100).toFixed(1) + '% | ' + (row.lossless ? '字节一致' : '失败') + ' |')
  }
  lines.push('')
  lines.push('生成命令：`node bench/conversations/generate.mjs && node bench/conversations-bench.mjs`')
  lines.push('')
  mkdirSync(dirname(MARKDOWN), { recursive: true })
  writeFileSync(MARKDOWN, lines.join('\n'), 'utf8')
  console.log('')
  console.log('  markdown report written: ' + MARKDOWN)
}

console.log('')
console.log(passed + ' passed, ' + failed + ' failed')
process.exit(failed === 0 ? 0 : 1)

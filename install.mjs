#!/usr/bin/env node
/**
 * Install `headroom` into a DeepSeek Harness deployment.
 *
 * Four things happen here, in this order:
 *
 *   1. RESOLVE every path the deployment needs, from four override layers, and
 *      report where each answer came from (`dsh-paths.mjs`).
 *   2. COPY the plugin into `<DSH_HOME>/profiles/node_modules/dsh-plugin-headroom`.
 *   3. OPTIONALLY append the host row to the profile's `cordis.patch.yml`.
 *   4. TEST the installed copy, in a child process, and print the result.
 *
 * Why that copy location, and why it is not assumed: a host row names its plugin
 * by PACKAGE NAME, and a bare name resolves by walking `node_modules` upward
 * from the profile directory. The walk begins at the profile directory's PARENT,
 * so `<DSH_HOME>/profiles/node_modules` is reachable while
 * `<profile>/node_modules` is never consulted at all. `dsh-paths.mjs` reproduces
 * that walk and reports where it landed, rather than trusting a literal —
 * installing one level too deep puts the package on disk and loads nothing.
 *
 * Paths can be overridden on the command line, in the environment, or in
 * `dsh-paths.json` beside `dsh-paths.mjs`. Run with `--print-paths` to see the
 * full resolution report, or `--write-paths` to write the detected values into
 * that file as a starting point for manual editing.
 *
 * Neither the package root nor the profile is inside a session workspace, so a
 * sandboxed agent running this needs write access beyond `workspace-write`.
 *
 * Usage:
 *   node install.mjs                     # resolve, copy, test the installed copy
 *   node install.mjs --dry-run           # report what would change; write nothing
 *   node install.mjs --print-paths       # the resolution report, then exit
 *   node install.mjs --write-paths       # write detected paths to dsh-paths.json
 *   node install.mjs --yes               # merge the row without prompting
 *   node install.mjs --no-test           # copy only, skip the post-install test
 *   node install.mjs --dsh-home <path>   # override any resolved path
 *   node install.mjs --profile <name>    # override the profile (default: web)
 *   node install.mjs --self-test         # alias of the default post-install test
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createInterface } from 'node:readline'
import { HERE, OVERRIDE_FILE, PACKAGE_NAME, paths, report, requirePath } from './dsh-paths.mjs'

const argv = process.argv.slice(2)
const has = (flag) => argv.includes(flag)

const dryRun = has('--dry-run')
const assumeYes = has('--yes')
const noTest = has('--no-test')
const printPaths = has('--print-paths')
const writePaths = has('--write-paths')

const resolved = paths()

/** Source file -> destination under the package root. */
const FILES = [
  ['plugin/index.js', join('plugin', 'index.js')],
  [join('plugin', 'lib', 'engine.js'), join('plugin', 'lib', 'engine.js')],
  // The resolver ships inside the plugin directory, which is where the plugin's
  // own tooling looks for it.
  ['dsh-paths.mjs', join('plugin', 'dsh-paths.mjs')],
  // The smoke test ships at the package root and tries a short list of locations
  // for the resolver, so it works from either place.
  ['smoke-installed.mjs', 'smoke-installed.mjs'],
  ['package.json', 'package.json'],
]

// ── 1. resolution report ────────────────────────────────────────────────────

if (printPaths) {
  console.log(has('--json') ? JSON.stringify(resolved, null, 2) : report())
  process.exit(0)
}

console.log('headroom installer')
console.log('  source    ' + HERE)
console.log('')
console.log(report())
console.log('')

if (writePaths) {
  // Only the two roots are written: everything else derives from them, and
  // freezing derived values would override detection that can keep them right.
  const payload = {
    _comment:
      'Optional overrides for dsh-paths.mjs. Written by `node install.mjs --write-paths`. ' +
      'Delete a key to fall back to detection. Relative paths resolve against this file. ' +
      'Command line and environment take precedence over anything here.',
    profile: resolved.profile,
    dshHome: resolved.dshHome,
    runtimeRoot: resolved.runtimeRoot,
  }
  if (dryRun) {
    console.log('would write ' + OVERRIDE_FILE + ':')
    console.log(JSON.stringify(payload, null, 2))
  } else {
    writeFileSync(OVERRIDE_FILE, JSON.stringify(payload, null, 2) + '\n', 'utf8')
    console.log('wrote ' + OVERRIDE_FILE)
  }
  console.log('')
}

if (resolved.overrideFile !== null) {
  console.log('note: an override file is in effect (' + resolved.overrideFile + '),')
  console.log('      so the values above may not be what is used.')
  console.log('')
}

// ── 2. the package ─────────────────────────────────────────────────────────

const packageParent = requirePath('packageParent')
const PACKAGE_ROOT = resolved.installedRoot ?? join(packageParent, 'node_modules', PACKAGE_NAME)

if (!dryRun && !existsSync(packageParent)) {
  console.error('\nThe resolved PACKAGE_PARENT does not exist: ' + packageParent)
  console.error('  source: ' + resolved.packageParentSource)
  console.error('  Override with --dsh-home <path>, or ' + OVERRIDE_FILE + '.')
  process.exit(1)
}

let changed = 0
let unchanged = 0
for (const [from, to] of FILES) {
  const source = join(HERE, from)
  const target = join(PACKAGE_ROOT, to)
  if (!existsSync(source)) {
    console.error('\nMissing source file: ' + source)
    process.exit(1)
  }
  const same = existsSync(target) && readFileSync(target, 'utf8') === readFileSync(source, 'utf8')
  if (same) {
    unchanged += 1
    console.log('  unchanged  ' + to)
    continue
  }
  changed += 1
  if (dryRun) {
    console.log('  would copy ' + to + (existsSync(target) ? ' (update)' : ' (new)'))
    continue
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  console.log('  copied     ' + to)
}

// ── 3. the row ─────────────────────────────────────────────────────────────

const PATCH = resolved.patchFile
if (PATCH === null || !existsSync(PATCH)) {
  console.error('\nNo profile patch layer at ' + String(PATCH) + '.')
  console.error('Resolved PROFILE_ROOT: ' + String(resolved.profileRoot) + '  [' + resolved.profileRootSource + ']')
  const profilesRoot = resolved.profilesRoot
  if (profilesRoot !== null && existsSync(profilesRoot)) {
    try {
      const found = readdirSync(profilesRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
        .map((entry) => entry.name)
      if (found.length > 0) console.error('Profiles present: ' + found.join(', ') + '  — re-run with --profile <name>.')
    } catch {
      // The profiles directory is unreadable; the message above is enough.
    }
  }
  console.error('Override with --profile <name>, --dsh-home <path>, or ' + OVERRIDE_FILE + '.')
  process.exit(1)
}

const ROW = [
  '',
  '# headroom — always-on context compression. Registers the `headroom` tool in',
  '# every session, whichever agent preset it uses. Loaded from',
  '# ' + PACKAGE_ROOT + ',',
  '# which is where a bare package name resolves for a host-plane row.',
  '- insert:',
  '    - id: headroom',
  "      name: '" + PACKAGE_NAME + "'",
  '      config:',
  '        ttlMinutes: 60',
  '        storeMax: 256',
].join('\n')

const rowPresent = (text) => /^\s*-\s*id:\s*headroom\s*$/m.test(text)

/**
 * Refuse the one patch-layer shape that is definitely broken: an empty `[]`
 * document left above real rows. Two top-level `- ` items are ONE array with two
 * entries and are perfectly valid — an earlier version of this check counted
 * them and rejected every legitimately populated profile.
 */
function emptyDocumentLeftBehind(text) {
  const lines = text.split('\n')
  const hasEmptyRoot = lines.some((line) => line === '[]' || line === '---')
  const hasRows = lines.some((line) => line.startsWith('- ') || line === '-')
  return hasEmptyRoot && hasRows
}

const patchText = readFileSync(PATCH, 'utf8')
if (emptyDocumentLeftBehind(patchText)) {
  console.error('\n' + PATCH + ' holds an empty `[]` document AND real rows, which is')
  console.error('two top-level YAML documents. Delete the lone `[]` line and re-run;')
  console.error('the loader requires a single top-level array.')
  process.exit(1)
}

async function confirm(question) {
  if (assumeYes) return true
  if (!process.stdin.isTTY) {
    console.log('\nNo terminal to prompt on; re-run with --yes to add the row.')
    return false
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise((done) => rl.question(question, done))
  rl.close()
  return /^y(es)?$/i.test(answer.trim())
}

if (rowPresent(patchText)) {
  console.log('\nrow `headroom` is already present in cordis.patch.yml')
} else if (dryRun) {
  console.log('\nwould append this row to ' + PATCH + ':')
  console.log(ROW)
} else {
  console.log('\nThis row will be appended to ' + PATCH + ':')
  console.log(ROW)
  if (await confirm('\nAppend it? [y/N] ')) {
    // The file is a top-level YAML array, so the row is appended, never merged.
    writeFileSync(PATCH, patchText.replace(/\s*$/, '\n') + ROW + '\n', 'utf8')
    changed += 1
    console.log('appended the row')
  } else {
    console.log('skipped; headroom will not load until the row is present')
  }
}

// ── report ─────────────────────────────────────────────────────────────────

const enabled = rowPresent(readFileSync(PATCH, 'utf8'))
console.log('')
console.log(enabled ? 'headroom is ENABLED for this profile.' : 'headroom is NOT enabled (row missing).')
console.log('')
console.log(dryRun ? 'dry run: nothing written' : changed + ' written, ' + unchanged + ' already current')

// ── 4. test the installed copy ─────────────────────────────────────────────

if (dryRun || noTest) {
  console.log('')
  console.log(dryRun ? 'skipped the post-install test (dry run)' : 'skipped the post-install test (--no-test)')
  process.exit(0)
}

/**
 * Test the copy that was just written, in child processes.
 *
 * A subprocess matters: this script has already imported its own sources, so
 * anything checked in-process would describe this directory rather than the
 * installation. `verify.mjs` is pointed at the installed entry explicitly, and
 * `smoke-installed.mjs` resolves it through the resolver that now sits beside
 * the installed plugin — which is also the only way to prove the installed
 * resolver reaches the installed copy.
 */
const SUITES = [
  ['verify.mjs', ['--entry', join(PACKAGE_ROOT, 'plugin', 'index.js')], 'installed copy: registration, round trip, query retrieve'],
  [join(PACKAGE_ROOT, 'smoke-installed.mjs'), [], 'installed resolver: resolves the installed plugin and exercises it'],
]

console.log('')
console.log('post-install test (child processes, against the installed copy)')
console.log('')

let failures = 0
let skipped = 0
for (const [script, extra, what] of SUITES) {
  if (!existsSync(script)) {
    console.log('  skip    ' + script + ' (not present)')
    skipped += 1
    continue
  }
  const started = Date.now()
  const run = spawnSync(process.execPath, [script, ...extra], { cwd: HERE, encoding: 'utf8', env: process.env })
  const elapsed = Date.now() - started
  const output = String(run.stdout ?? '') + String(run.stderr ?? '')
  const tail = output.trim().split('\n').filter((line) => line.trim() !== '').slice(-1)[0] ?? ''

  if (run.status === 0) {
    console.log('  ok      ' + relative(HERE, script).padEnd(30) + String(elapsed + 'ms').padStart(7) + '   ' + tail)
    console.log('            ' + what)
    continue
  }
  failures += 1
  console.log('  FAILED  ' + relative(HERE, script).padEnd(30) + String(elapsed + 'ms').padStart(7))
  for (const line of output.trim().split('\n').slice(-14)) console.log('            ' + line)
}

console.log('')
if (failures > 0) {
  console.log(failures + ' suite(s) failed. The installed copy did not pass its own tests.')
  process.exit(1)
}
if (enabled) {
  console.log('Restart the harness to guarantee the row is picked up, then look for a')
  console.log('`headroom` tool in the next session.')
}
console.log('installed package: ' + PACKAGE_ROOT + '  (' + statSync(join(PACKAGE_ROOT, 'plugin', 'index.js')).size + ' bytes)')

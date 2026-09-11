/**
 * Install / update headroom into a DeepSeek Harness deployment.
 *
 * Four things happen here, in this order:
 *
 *   1. RESOLVE every path the deployment needs, from four override layers, and
 *      report where each answer came from (`dsh-paths.mjs`). Nothing in this
 *      repository hardcodes a machine layout any more; the report is the proof.
 *   2. COPY the plugin into the profile's host plane.
 *   3. OPTIONALLY append the host row that turns it on.
 *   4. TEST the installed copy, in a child process, and print the numbers.
 *
 * Why the host plane: the plugin is loaded as an ordinary host row resolved by
 * package name. A bare name resolves only if the package sits inside a
 * `node_modules` that the upward walk from the profile directory reaches, and
 * `<profiles>/node_modules` is that location. A copy under
 * `<profile>/node_modules` is not on the walk at all — installing one level too
 * deep puts the package on disk and loads nothing. `dsh-paths.mjs` reproduces
 * that walk rather than assuming the answer.
 *
 * There is deliberately no agent preset: a preset registers the tool in its own
 * scope while the host row registers it globally, and `tools.register()` rejects
 * a duplicate name, so selecting such a preset would fail. An installation from
 * an earlier layout retires that preset, and clears a user default naming it:
 * the default is what a session with no explicit pick resolves, and one that
 * resolves to nothing fails the session instead.
 *
 * The package root is usually outside the session workspace, so a sandboxed
 * agent needs write access beyond `workspace-write`.
 *
 * Usage:
 *   node install.mjs                     # resolve, copy, test the installed copy
 *   node install.mjs --enable-host       # also append the row to the patch layer
 *   node install.mjs --dry-run           # report drift; write nothing, test nothing
 *   node install.mjs --print-paths       # the resolution report, then exit
 *   node install.mjs --write-paths       # write the detected paths to dsh-paths.json
 *   node install.mjs --no-test           # copy only, skip the post-install test
 *   node install.mjs --dsh-home <path>   # override any resolved path
 *   node install.mjs --profile <name>    # override the profile (default: web)
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { HERE, PACKAGE_NAME, OVERRIDE_FILE, paths, report, requirePath } from './dsh-paths.mjs'

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const enableHost = args.has('--enable-host')
const noTest = args.has('--no-test')
const printPaths = args.has('--print-paths')
const writePaths = args.has('--write-paths')
const jsonReport = args.has('--json')

const resolved = paths()

/**
 * The two manifests must stay identical.
 *
 * Both installers ship `package.json` to the same place, so if the repository's
 * copy and the standalone package's copy drift apart, whichever installer ran
 * last silently wins and "already current" becomes meaningless. This is a
 * warning rather than a failure: a deliberately different manifest is a valid
 * thing to want, it just should not happen by accident.
 */
const siblingManifest = join(HERE, '..', 'headroom-package', 'package.json')
if (existsSync(siblingManifest)) {
  const mine = readFileSync(join(HERE, 'package.json'), 'utf8')
  const theirs = readFileSync(siblingManifest, 'utf8')
  if (mine !== theirs) {
    console.log('warning: package.json differs from headroom-package/package.json.')
    console.log('         Both installers write that file, so the last one to run wins.')
    console.log('')
  }
}

/** Source file -> destination under the package root. */
const FILES = [
  ['index.js', join('plugin', 'index.js')],
  [join('lib', 'engine.js'), join('plugin', 'lib', 'engine.js')],
  // The resolver ships with the package: the installed copy's own test entry
  // points live under the plugin directory and must find them the same way the
  // repository does.
  ['dsh-paths.mjs', join('plugin', 'dsh-paths.mjs')],
  ['package.json', 'package.json'],
]
// ── 1. resolution report ────────────────────────────────────────────────────

if (printPaths) {
  console.log(jsonReport ? JSON.stringify(resolved, null, 2) : report())
  process.exit(0)
}

console.log('headroom installer')
console.log('')
console.log(report())
console.log('')

if (writePaths) {
  // Only the two roots are written: every other location derives from them, and
  // writing derived values too would freeze an answer that detection can keep
  // correct on its own.
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
  console.log('      so detected values below may not be what is used.')
  console.log('')
}

// ── 2. the host package ────────────────────────────────────────────────────

// `installedRoot` is derived from PACKAGE_PARENT, so asking for PACKAGE_PARENT is
// what produces the explanatory failure when the deployment cannot be located.
const packageParent = requirePath('packageParent')
const hostRoot = resolved.installedRoot ?? join(packageParent, 'node_modules', PACKAGE_NAME)
console.log('host package  ' + hostRoot)

let changed = 0
let unchanged = 0
const report_ = (status, label) => {
  if (status === 'unchanged') unchanged += 1
  else changed += 1
  console.log('  ' + status.padEnd(11) + label)
}

for (const [from, to] of FILES) {
  const source = join(HERE, from)
  const target = join(hostRoot, to)
  if (!existsSync(source)) {
    console.error('\nMissing source file: ' + source)
    process.exit(1)
  }
  const same = existsSync(target) && readFileSync(target, 'utf8') === readFileSync(source, 'utf8')
  if (same) {
    report_('unchanged', to)
    continue
  }
  if (dryRun) {
    report_('would copy', to + (existsSync(target) ? ' (update)' : ' (new)'))
    continue
  }
  mkdirSync(dirname(target), { recursive: true })
  copyFileSync(source, target)
  report_('copied', to)
}

/** Remove a stale path from an earlier layout, reporting what happened. */
function drop(target, why) {
  if (target === null || !existsSync(target)) return
  if (dryRun) {
    console.log('  would rm   ' + target + ' (' + why + ')')
    return
  }
  rmSync(target, { recursive: true, force: true })
  console.log('  removed    ' + target + ' (' + why + ')')
}

// A copy under `<profile>/node_modules` is not on the resolver's walk.
drop(resolved.profileRoot === null ? null : join(resolved.profileRoot, 'node_modules', PACKAGE_NAME), 'not on the resolver walk')

// The retired agent preset: it registered the same tool name as the host row.
const RETIRED_PRESET = 'headroom'
drop(resolved.presetsRoot === null ? null : join(resolved.presetsRoot, RETIRED_PRESET), 'retired; the host row replaced it')

/**
 * Clear a user default that names the preset this run just retired.
 *
 * Retiring the directory is only half the migration. `AgentPresets.remove()`
 * clears a user default naming the preset it deletes, because a default that
 * resolves to nothing fails every session created without an explicit pick —
 * and in the Web UI that failure surfaces as the workspace selection clearing
 * back to unselected, since the create behind it is what rejected. This
 * installer deletes the directory directly instead of calling `remove()`, so
 * it owes the same cleanup or it strands exactly that state.
 *
 * The settings document is a small block-style YAML file the harness writes
 * itself, so this edits the one line rather than parsing and re-dumping a
 * document whose unrelated formatting belongs to its owner.
 *
 * @param dshHome - resolved deployment home holding `settings.yaml`, or null.
 * @returns whether a dangling default was found (and, when not dry, cleared).
 */
function clearRetiredPresetDefault(dshHome) {
  const settingsFile = dshHome === null ? null : join(dshHome, 'settings.yaml')
  if (settingsFile === null || !existsSync(settingsFile)) return false
  const lines = readFileSync(settingsFile, 'utf8').split('\n')
  const header = lines.findIndex(line => /^agent-presets:\s*$/.test(line))
  if (header === -1) return false
  let end = header + 1
  while (end < lines.length && !/^\S/.test(lines[end])) end += 1
  const block = lines.slice(header + 1, end)
  const kept = block.filter(line => !new RegExp(`^\\s+default:\\s*['"]?${RETIRED_PRESET}['"]?\\s*$`).test(line))
  if (kept.length === block.length) return false
  if (dryRun) {
    console.log('  would clear the default agent preset that named "' + RETIRED_PRESET + '" in ' + settingsFile)
    return true
  }
  // The header stays while a sibling entry survives the removal, and goes with
  // the block when none does: an `agent-presets: {}` would say the same thing
  // as no block at all, only less plainly.
  const next = kept.some(line => line.trim() !== '')
    ? [...lines.slice(0, header + 1), ...kept, ...lines.slice(end)]
    : [...lines.slice(0, header), ...lines.slice(end)]
  writeFileSync(settingsFile, next.join('\n'), 'utf8')
  console.log('  cleared    the default agent preset that named "' + RETIRED_PRESET + '" in ' + settingsFile)
  return true
}

clearRetiredPresetDefault(resolved.dshHome)

// ── 3. the row that turns it on ────────────────────────────────────────────

const PATCH = resolved.patchFile
if (PATCH === null || !existsSync(PATCH)) {
  console.error('\nNo profile patch layer at ' + String(PATCH) + '; cannot register the row.')
  console.error('Resolved PROFILE_ROOT: ' + String(resolved.profileRoot) + ' [' + resolved.profileRootSource + ']')
  console.error('Override with --profile <name>, --dsh-home <path>, or ' + OVERRIDE_FILE + '.')
  process.exit(1)
}

const ROW = [
  '',
  '# headroom — always-on context compression. Registers the `headroom` tool in',
  '# every session, whichever agent preset it uses. Loaded from',
  '# ' + hostRoot + ',',
  '# which is where a bare package name resolves for a host-plane row.',
  '- insert:',
  '    - id: headroom',
  "      name: '" + PACKAGE_NAME + "'",
  '      config:',
  '        ttlMinutes: 60',
  '        storeMax: 256',
].join('\n')

const rowPresent = (text) => /^\s*-\s*id:\s*headroom\s*$/m.test(text)
const alreadyOn = rowPresent(readFileSync(PATCH, 'utf8'))

if (!alreadyOn && enableHost && !dryRun) {
  writeFileSync(PATCH, readFileSync(PATCH, 'utf8').replace(/\s*$/, '\n') + ROW + '\n', 'utf8')
  console.log('\nappended the headroom row to ' + PATCH)
} else if (!alreadyOn && enableHost && dryRun) {
  console.log('\nwould append the headroom row to ' + PATCH)
}

// Re-read rather than trusting the branch above: this report is about the file
// on disk, not about what this run intended.
const enabled = rowPresent(readFileSync(PATCH, 'utf8'))

console.log('')
if (enabled) {
  console.log('headroom is ENABLED: row `headroom` is present in cordis.patch.yml,')
  console.log('so the tool loads in every session regardless of agent preset.')
} else {
  console.log('headroom is NOT enabled. To make it always-on, add this to')
  console.log(PATCH + ':')
  console.log(ROW)
  if (!enableHost) console.log('\nor re-run with --enable-host to append it automatically.')
}

console.log('')
console.log(dryRun ? 'dry run: nothing written' : changed + ' written, ' + unchanged + ' already current')

// ── 4. test the installed copy ─────────────────────────────────────────────

if (dryRun || noTest) {
  console.log('')
  console.log(dryRun ? 'skipped the post-install test (dry run)' : 'skipped the post-install test (--no-test)')
  process.exit(0)
}

/**
 * Run the child suites against the copy that was just written.
 *
 * The subprocess matters. This script has already imported its own sources, so
 * anything it verified in-process would be testing the repository, not the
 * installation. Every suite below loads the installed file by absolute path, or
 * resolves it through `dsh-paths.mjs`, which now points at the install root.
 *
 * A suite that cannot run for want of a package is reported as skipped rather
 * than failed: the DSH internals it wants (`dsh-tools`, `dsh-token-meter`) are
 * not part of this plugin, and their absence says nothing about the plugin.
 */
const SUITES = [
  ['smoke-installed.mjs', 'installed copy: registration, round trip, query retrieve'],
  ['test/engine.test.mjs', 'engine: compression, losslessness, store, retrieval'],
  ['test/tool-contract.test.mjs', 'tool contract: schema and per-action validation'],
  ['test/verify-host.mjs', 'host plane: patch layer, resolution walk, installed module'],
]

console.log('')
console.log('post-install test (child processes, against the installed copy)')
console.log('')

let failedSuites = 0
let skippedSuites = 0
for (const [script, what] of SUITES) {
  const absolute = join(HERE, script)
  if (!existsSync(absolute)) {
    console.log('  skip    ' + script + ' (not present)')
    skippedSuites += 1
    continue
  }
  const started = Date.now()
  const run = spawnSync(process.execPath, [absolute], {
    cwd: HERE,
    encoding: 'utf8',
    env: process.env,
  })
  const elapsed = Date.now() - started
  const output = String(run.stdout ?? '') + String(run.stderr ?? '')
  const tail = output.trim().split('\n').filter((line) => line.trim() !== '').slice(-1)[0] ?? ''

  if (run.status === 0) {
    console.log('  ok      ' + script.padEnd(30) + String(elapsed + 'ms').padStart(7) + '   ' + tail)
    continue
  }

  // Distinguish "this plugin is broken" from "this machine lacks a DSH package".
  const missingDep = /Cannot find module|ERR_MODULE_NOT_FOUND/.test(output) && /dsh-tools|dsh-token-meter|js-yaml/.test(output)
  if (missingDep) {
    console.log('  skip    ' + script.padEnd(30) + 'needs a DSH package that is not resolvable here')
    skippedSuites += 1
    continue
  }

  failedSuites += 1
  console.log('  FAILED  ' + script.padEnd(30) + String(elapsed + 'ms').padStart(7))
  for (const line of output.trim().split('\n').slice(-14)) console.log('            ' + line)
}

console.log('')
if (failedSuites > 0) {
  console.log(failedSuites + ' suite(s) failed' + (skippedSuites > 0 ? ', ' + skippedSuites + ' skipped' : '') + '.')
  console.log('The installed copy did not pass its own tests; see the output above.')
  process.exit(1)
}

console.log(
  (SUITES.length - skippedSuites) + ' suite(s) passed' +
    (skippedSuites > 0 ? ', ' + skippedSuites + ' skipped' : '') +
    '. The installed copy at',
)
console.log(hostRoot + ' is current and working.')
console.log('')
console.log('Restart the harness to guarantee the row is picked up, then look for a')
console.log('`headroom` tool in the next session.')

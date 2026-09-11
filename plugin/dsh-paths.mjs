/**
 * Where everything lives.
 *
 * Every script in this repository — tests, benchmarks, the installer, the smoke
 * test — needs some subset of the same six locations:
 *
 *   DSH_HOME        the deployment root (holds profiles/, .agent-presets/, …)
 *   PROFILES_ROOT   <DSH_HOME>/profiles            (the resolver walk's first stop)
 *   PROFILE_ROOT    <PROFILES_ROOT>/<profile>      (holds cordis.patch.yml)
 *   PRESETS_ROOT    <DSH_HOME>/.agent-presets
 *   RUNTIME_ROOT    the DSH installation, where node_modules/@deepseek-ai/* is
 *   INSTALLED_ENTRY <PROFILES_ROOT>/node_modules/dsh-plugin-headroom/plugin/index.js
 *
 * These used to be string literals in seven files, each pointed at one machine's
 * layout. This module resolves them once, reports WHERE each answer came from,
 * and lets every source be overridden. Resolution order, highest first:
 *
 *   1. command line         --dsh-home <path>, --profile <name>, --runtime-root <path>
 *   2. environment          DSH_HOME, HEADROOM_PROFILE, HEADROOM_RUNTIME_ROOT, …
 *   3. override file        dsh-paths.json beside this module, or a `dshPaths`
 *                           field in package.json
 *   4. auto-detection       derived from this file's own location, the node
 *                           executable, and the well-known install locations
 *
 * The override file exists so that a layout nobody anticipated — a portable
 * install on a USB stick, a CI container, a second harness beside the first —
 * can be described rather than patched. Run `node install.mjs --write-paths` to
 * write the currently detected values there as a starting point.
 *
 * Nothing here throws on a missing path. A path that does not exist is reported
 * as missing with its source, so a caller can decide whether that matters: a
 * benchmark needs the runtime, whereas the installer is allowed to create the
 * package directory it is about to write into.
 *
 * @module dsh-paths
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, isAbsolute } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

export const HERE = dirname(fileURLToPath(import.meta.url))

/** Where the plugin is installed, relative to PROFILES_ROOT. */
export const PACKAGE_NAME = 'dsh-plugin-headroom'
export const PACKAGE_SEGMENTS = ['node_modules', PACKAGE_NAME, 'plugin', 'index.js']

/** The override file, beside this module. */
export const OVERRIDE_FILE = join(HERE, 'dsh-paths.json')

// ── argument and environment access ─────────────────────────────────────────

const argv = process.argv.slice(2)

/**
 * Normalise a path that arrived from outside this process.
 *
 * Three shapes reach here from a shell and none of them are paths on their own:
 *
 *   "D:\\dsh\\home"   surrounding quotes, which Windows users add habitually
 *                     (`set DSH_HOME="D:\dsh\home"` keeps them in the value)
 *   ~/dsh/home        a tilde, which only POSIX shells expand
 *   %DSH_HOME%        Windows-style indirection, never expanded for us
 *
 * Left alone, each becomes a literal directory name and quietly resolves to a
 * path that does not exist — the failure then looks like a missing install
 * rather than a quoting mistake.
 */
function normalisePath(raw) {
  let text = String(raw).trim()
  // Strip one matched pair of surrounding quotes.
  const quoted = /^(['"])([\s\S]*)\1$/.exec(text)
  if (quoted !== null) text = quoted[2].trim()
  if (text === '') return text
  // Expand a leading tilde against the home directory.
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return text
}

const flag = (name) => {
  const at = argv.indexOf('--' + name)
  if (at === -1) return undefined
  const value = argv[at + 1]
  return value === undefined || value.startsWith('--') ? undefined : value
}

const env = (...names) => {
  for (const name of names) {
    const value = process.env[name]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/** Read the override file, or the `dshPaths` field of package.json. */
function readOverrides() {
  const sources = [
    [OVERRIDE_FILE, (text) => JSON.parse(text)],
    [join(HERE, 'package.json'), (text) => JSON.parse(text).dshPaths ?? {}],
  ]
  for (const [file, parse] of sources) {
    if (!existsSync(file)) continue
    try {
      // Strip a UTF-8 BOM before parsing. PowerShell's `Set-Content -Encoding
      // utf8` writes one, as do several Windows editors, and `JSON.parse`
      // rejects it — so a hand-edited override file would silently fall back to
      // detection while looking perfectly correct in the editor.
      const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
      const parsed = parse(text)
      if (parsed !== null && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
        return { file, values: parsed }
      }
    } catch (error) {
      console.error('warning: ignoring ' + file + ' (' + String(error.message) + ')')
    }
  }
  return { file: null, values: {} }
}

const overrides = readOverrides()

/**
 * Pick a value from the four sources in order.
 *
 * @returns `{ value, source }` where source names the layer that answered.
 */
function pick({ cli, envNames = [], overrideKeys = [], detect }) {
  const fromCli = cli === undefined ? undefined : flag(cli)
  if (fromCli !== undefined) return { value: resolve(normalisePath(fromCli)), source: 'cli --' + cli }

  const fromEnv = env(...envNames)
  if (fromEnv !== undefined) return { value: resolve(normalisePath(fromEnv)), source: 'env ' + envNames[0] }

  for (const key of overrideKeys) {
    const value = overrides.values[key]
    if (typeof value === 'string' && value.trim() !== '') {
      const raw = normalisePath(value)
      if (raw === '') continue
      // A relative path in the override file is relative to that file, so a
      // checkout can be moved without editing absolute paths.
      const base = overrides.file === null ? HERE : dirname(overrides.file)
      return {
        value: isAbsolute(raw) ? resolve(raw) : resolve(base, raw),
        source: (overrides.file === null ? 'override' : 'override ' + overrides.file.split(/[\\/]/).pop()) + ':' + key,
      }
    }
  }

  const detected = detect()
  return detected === undefined || detected === null
    ? { value: null, source: 'not found' }
    : { value: resolve(detected), source: 'auto' }
}

// ── auto-detection ──────────────────────────────────────────────────────────

/**
 * Does this directory look like a DSH installation?
 *
 * The markers are `node_modules/@deepseek-ai` (the scoped packages every DSH
 * runtime carries) and `package.json`. Requiring both avoids accepting a random
 * parent directory that happens to contain a `node_modules`.
 */
function looksLikeRuntime(dir) {
  return existsSync(join(dir, 'package.json')) && existsSync(join(dir, 'node_modules', '@deepseek-ai'))
}

/** Does this directory look like a DSH home? */
function looksLikeHome(dir) {
  return existsSync(join(dir, 'profiles')) || existsSync(join(dir, 'settings.yaml'))
}

/**
 * Find the runtime by walking up from a starting point.
 *
 * Also tries the global npm/pnpm layouts, because a DSH installed with
 * `npm i -g` has no relationship to this file's location at all.
 */
function detectRuntimeRoot() {
  const seeds = [
    // This module's own directory and its ancestors.
    ...ancestors(HERE),
    // The node executable: a global install puts the runtime near it.
    ...ancestors(dirname(process.execPath)),
    // A home-relative install.
    ...(env('DSH_HOME') === undefined ? [] : ancestors(env('DSH_HOME'))),
  ]
  for (const dir of seeds) {
    if (looksLikeRuntime(dir)) return dir
  }
  for (const candidate of ['D:/dsh/runtime/dsh', 'C:/dsh/runtime/dsh', '/opt/dsh/runtime/dsh']) {
    if (looksLikeRuntime(candidate)) return candidate
  }
  return undefined
}

/** This directory and every ancestor, nearest first. */
function ancestors(start) {
  const out = []
  let current = resolve(start)
  for (;;) {
    out.push(current)
    const parent = dirname(current)
    if (parent === current) return out
    current = parent
  }
}

function detectDshHome() {
  // A sibling of the runtime, which is how this deployment is laid out:
  // <root>/runtime/dsh and <root>/home.
  const runtime = detectRuntimeRoot()
  if (runtime !== undefined) {
    const runtimeParent = dirname(dirname(runtime))
    for (const candidate of [join(runtimeParent, 'home'), join(dirname(runtime), 'home')]) {
      if (looksLikeHome(candidate)) return candidate
    }
  }
  for (const candidate of [join(homedir(), '.dsh')]) {
    if (looksLikeHome(candidate)) return candidate
  }
  return undefined
}

/**
 * Find the profiles' node_modules by walking upward from the profile directory
 * until a `node_modules` containing the package appears.
 *
 * This mirrors what the harness's own resolver does for a bare package name, so
 * the location this module reports is the one the loader will actually reach.
 */
function detectPackageParent(profileRoot, dshHome) {
  for (const dir of ancestors(profileRoot)) {
    if (existsSync(join(dir, 'node_modules', PACKAGE_NAME))) return dir
  }
  for (const dir of ancestors(profileRoot)) {
    if (dir.endsWith('node_modules')) continue
    if (existsSync(join(dir, 'node_modules'))) return dir
  }
  return dshHome === null ? undefined : join(dshHome, 'profiles')
}

// ── resolve ─────────────────────────────────────────────────────────────────

/**
 * Resolve every path, recording the layer that answered for each one.
 *
 * Each entry carries `value` (absolute path or null), `source`, and `exists`.
 * The profile name participates in resolution, so it is reported too.
 */
export function resolvePaths() {
  const profileFrom = { value: null, source: 'default' }
  const profileCli = flag('profile')
  const profileEnv = env('HEADROOM_PROFILE', 'DSH_PROFILE')
  if (profileCli !== undefined) {
    profileFrom.value = profileCli
    profileFrom.source = 'cli --profile'
  } else if (profileEnv !== undefined) {
    profileFrom.value = profileEnv
    profileFrom.source = 'env HEADROOM_PROFILE'
  } else if (typeof overrides.values.profile === 'string' && overrides.values.profile.trim() !== '') {
    profileFrom.value = overrides.values.profile.trim()
    profileFrom.source = 'override:profile'
  } else {
    profileFrom.value = 'web'
    profileFrom.source = 'default'
  }
  const profileName = profileFrom.value

  const home = pick({
    cli: 'dsh-home',
    envNames: ['DSH_HOME', 'HEADROOM_DSH_HOME'],
    overrideKeys: ['dshHome', 'DSH_HOME'],
    detect: detectDshHome,
  })

  const runtime = pick({
    cli: 'runtime-root',
    envNames: ['HEADROOM_RUNTIME_ROOT', 'DSH_RUNTIME_ROOT'],
    overrideKeys: ['runtimeRoot', 'DSH_RUNTIME_ROOT'],
    detect: detectRuntimeRoot,
  })

  // The remaining paths derive from the two above, unless overridden outright.
  const derived = {
    profilesRoot: home.value === null ? null : join(home.value, 'profiles'),
    profileRoot: home.value === null ? null : join(home.value, 'profiles', profileName),
    presetsRoot: home.value === null ? null : join(home.value, '.agent-presets'),
    meterEntry: runtime.value === null ? null : join(runtime.value, 'node_modules', '@deepseek-ai', 'dsh-token-meter', 'lib', 'types', 'estimate.js'),
    toolsEntry: runtime.value === null ? null : join(runtime.value, 'node_modules', '@deepseek-ai', 'dsh-tools', 'lib', 'index.js'),
    yamlEntry: runtime.value === null ? null : join(runtime.value, 'node_modules', 'js-yaml'),
  }

  const profilesRoot = pick({
    envNames: ['HEADROOM_PACKAGE_DIR'],
    overrideKeys: ['profilesRoot'],
    detect: () => derived.profilesRoot,
  })
  const packageParent = pick({
    envNames: ['HEADROOM_PACKAGE_DIR'],
    overrideKeys: ['packageParent'],
    detect: () => detectPackageParent(derived.profileRoot ?? profilesRoot.value ?? HERE, home.value),
  })

  const raw = {
    dshHome: home,
    runtimeRoot: runtime,
    profilesRoot,
    profileRoot: pick({
      envNames: ['HEADROOM_PROFILE_DIR'],
      overrideKeys: ['profileRoot'],
      detect: () => derived.profileRoot,
    }),
    presetsRoot: pick({ overrideKeys: ['presetsRoot'], detect: () => derived.presetsRoot }),
    packageParent,
    meterEntry: pick({ envNames: ['HEADROOM_METER_ENTRY'], overrideKeys: ['meterEntry'], detect: () => derived.meterEntry }),
    toolsEntry: pick({ envNames: ['HEADROOM_TOOLS_ENTRY'], overrideKeys: ['toolsEntry'], detect: () => derived.toolsEntry }),
    yamlEntry: pick({ overrideKeys: ['yamlEntry'], detect: () => derived.yamlEntry }),
  }

  const paths = { profile: profileName, profileSource: profileFrom.source }
  for (const [key, entry] of Object.entries(raw)) {
    paths[key] = entry.value
    paths[key + 'Source'] = entry.source
    paths[key + 'Exists'] = entry.value !== null && existsSync(entry.value)
  }
  // Derived from PACKAGE_PARENT and PROFILE_ROOT rather than resolved on their
  // own, so they carry no source of their own to report.
  paths.installedRoot = paths.packageParent === null ? null : join(paths.packageParent, 'node_modules', PACKAGE_NAME)
  paths.installedRootSource = 'derived PACKAGE_PARENT'
  paths.installedEntry = paths.installedRoot === null ? null : join(paths.installedRoot, ...PACKAGE_SEGMENTS.slice(2))
  paths.installedEntrySource = 'derived PACKAGE_PARENT'
  paths.installedExists = paths.installedEntry !== null && existsSync(paths.installedEntry)
  paths.patchFile = paths.profileRoot === null ? null : join(paths.profileRoot, 'cordis.patch.yml')
  paths.patchFileSource = 'derived PROFILE_ROOT'
  paths.patchExists = paths.patchFile !== null && existsSync(paths.patchFile)
  paths.overrideFile = overrides.file
  paths.overrideValues = overrides.values
  return paths
}

/** Resolve once; every caller in a process shares this answer. */
let cached = null
export function paths() {
  if (cached === null) cached = resolvePaths()
  return cached
}

/**
 * A resolved path, or a hard failure naming the key, the attempt history, and
 * how to override it.
 *
 * A missing path is usually a real setup problem, and a stack trace from deep
 * inside `readFileSync` says nothing useful about which of the four layers
 * should have answered. This says it directly.
 */
export function requirePath(key) {
  const all = paths()
  const value = all[key]
  if (typeof value !== 'string' || value === '') {
    console.error('cannot locate `' + key + '`.')
    console.error('  tried: command line, environment, override file, auto-detection')
    console.error('  override file: ' + OVERRIDE_FILE)
    console.error('  run `node install.mjs --print-paths` for the full resolution report.')
    process.exit(1)
  }
  return value
}

/** A resolved path only if it exists, or a hard failure explaining what is missing. */
export function requireExistingPath(key) {
  const value = requirePath(key)
  const all = paths()
  if (all[key + 'Exists'] === false) {
    console.error('`' + key + '` resolved to a path that does not exist:')
    console.error('  ' + value)
    console.error('  source: ' + all[key + 'Source'])
    console.error('  run `node install.mjs --print-paths` for the full resolution report.')
    process.exit(1)
  }
  return value
}

/** A `file://` URL for a path or a CJS entry, for `import()` and `createRequire`. */
export const asUrl = (target) => pathToFileURL(target).href

/**
 * The human-readable resolution report.
 *
 * Provenance is printed for every path, because "which copy am I testing?" is
 * the question this module exists to answer, and an answer without a source is
 * not checkable.
 */
export function report() {
  const all = paths()
  const rows = [
    ['dshHome', 'DSH_HOME', 'deployment root'],
    ['runtimeRoot', 'RUNTIME_ROOT', 'where @deepseek-ai/* lives'],
    ['profilesRoot', 'PROFILES_ROOT', "the resolver walk's first stop"],
    ['profileRoot', 'PROFILE_ROOT', 'holds cordis.patch.yml'],
    ['presetsRoot', 'PRESETS_ROOT', '.agent-presets'],
    ['packageParent', 'PACKAGE_PARENT', 'whose node_modules is reached'],
    ['installedRoot', 'INSTALLED_ROOT', 'the installed package'],
    ['installedEntry', 'INSTALLED_ENTRY', 'the file the harness loads'],
    ['meterEntry', 'METER_ENTRY', 'dsh-token-meter estimate.js'],
    ['toolsEntry', 'TOOLS_ENTRY', 'dsh-tools/lib/index.js'],
    ['yamlEntry', 'YAML_ENTRY', 'js-yaml'],
    ['patchFile', 'PATCH_FILE', 'host row lives here'],
  ]
  const width = Math.max(...rows.map(([, label]) => label.length))
  const lines = []
  lines.push('profile        ' + all.profile + '  [' + all.profileSource + ']')
  for (const [key, label, why] of rows) {
    const value = all[key]
    const exists = all[key + 'Exists']
    const mark = value === null ? 'MISSING' : exists === false ? 'absent ' : 'ok     '
    lines.push(
      mark + '  ' + label.padEnd(width) + '  ' + String(value ?? '—') +
        '\n            ' + ' '.repeat(width) + '  ' + why + '  [' + all[key + 'Source'] + ']',
    )
  }
  lines.push('')
  lines.push('override file  ' + (all.overrideFile ?? OVERRIDE_FILE + ' (not present)'))
  const keys = Object.keys(all.overrideValues ?? {})
  lines.push('overrides      ' + (keys.length === 0 ? 'none' : keys.join(', ')))
  return lines.join('\n')
}
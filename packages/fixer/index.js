/**
 * Host half of icex-dsh-fixer: starts the macOS summon helper and serves the
 * session-delete and bare-mode routes.
 *
 * The helper listens for a right-Option double tap and moves the DSH window to
 * the screen under the pointer. It lives outside the Web client because global
 * key events and native window bounds are not available to a browser plugin.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const helper = join(here, 'native', 'icex-summon')

/**
 * Start the native helper for this profile while the plugin row is active.
 * @param ctx - owning Cordis context.
 */
export function apply(ctx) {
  registerSessionDeleteRoute(ctx)
  registerBareModeRoute(ctx)
  if (process.platform !== 'darwin') return
  if (!existsSync(helper)) {
    console.warn('[icex-dsh-fixer] native summon helper is missing: ' + helper)
    return
  }
  ctx.effect(() => {
    let disposed = false
    let child = null
    let restartTimer = null
    const start = () => {
      if (disposed) return
      child = spawn(helper, [], { stdio: ['ignore', 'ignore', 'pipe'] })
      child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim()
        if (text !== '') console.warn('[icex-dsh-fixer] summon: ' + text)
      })
      child.on('error', (error) => {
        console.warn('[icex-dsh-fixer] summon helper failed: ' + error.message)
      })
      child.on('exit', (code, signal) => {
        child = null
        if (disposed) return
        if (code !== 0 && signal !== 'SIGTERM') {
          console.warn('[icex-dsh-fixer] summon helper exited: ' + String(code) + '/' + String(signal))
        }
        restartTimer = setTimeout(start, 2000)
      })
    }
    start()
    return () => {
      disposed = true
      if (restartTimer !== null) clearTimeout(restartTimer)
      if (child !== null) child.kill('SIGTERM')
    }
  }, 'icex-dsh-fixer: native summon helper')
}

/** Session logs live under the DSH home; deleted logs move to a trash folder. */
const DSH_HOME = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
const SESSIONS_ROOT = join(DSH_HOME, 'sessions')
const TRASH_ROOT = join(DSH_HOME, 'trash', 'sessions')

/** JSON response helper for the session-delete route. */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** Every on-disk directory for one session id, across project slug directories. */
function sessionDirectories(id) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(id)) return []
  if (!existsSync(SESSIONS_ROOT)) return []
  const found = []
  for (const entry of readdirSync(SESSIONS_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const dir = join(SESSIONS_ROOT, entry.name, id)
    if (existsSync(dir)) found.push(dir)
  }
  return found
}

/** Move a session's logs to the trash; the row disappears from the next list read. */
async function handleDeleteSession(request, ctx) {
  let body
  try {
    body = await request.json()
  } catch (error) {
    return jsonResponse({ ok: false, error: 'body is not JSON' }, 400)
  }
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (id === '') return jsonResponse({ ok: false, error: 'id is required' }, 400)

  let sessions
  let live = false
  try {
    sessions = ctx.get('sessions')
    if (sessions !== undefined && typeof sessions.get === 'function') live = sessions.get(id) !== undefined
  } catch (error) {
    // Without the registry, fall through to the on-disk check only.
  }
  // A running session is stopped and archived first: the workspace registry
  // cancels its turn, subagents, jobs and schedules through the same
  // `stopActivity` path the session menu's archive uses. Only then is it safe
  // to move the log out from under the writer. The archive also drops the row
  // and clears the main view, so the browser lands on the new-session page.
  if (live) {
    let workspace
    try {
      workspace = ctx.get('workspaceRegistry')
    } catch (error) {
      workspace = undefined
    }
    if (workspace === undefined || typeof workspace.archiveSession !== 'function') {
      return jsonResponse({ ok: false, error: 'session is running and cannot be stopped by this profile', code: 'live' }, 409)
    }
    try {
      await workspace.archiveSession(id, { stopActivity: true })
    } catch (error) {
      console.warn('[icex-dsh-fixer] could not stop session ' + id + ': ' + String(error?.message ?? error))
      return jsonResponse({ ok: false, error: 'session is running and could not be stopped', code: 'live' }, 409)
    }
    // Flush buffered events so the trash copy carries everything written so
    // far; a failure here is logged but does not block the deletion.
    try {
      const session = sessions.get(id)
      if (session !== undefined && typeof sessions.flush === 'function') await sessions.flush(session)
    } catch (error) {
      console.warn('[icex-dsh-fixer] could not flush session ' + id + ': ' + String(error?.message ?? error))
    }
  }

  const dirs = sessionDirectories(id)
  if (dirs.length === 0) return jsonResponse({ ok: false, error: 'session log not found', code: 'missing' }, 404)

  mkdirSync(TRASH_ROOT, { recursive: true })
  const moved = []
  for (const dir of dirs) {
    const target = join(TRASH_ROOT, id + '-' + Date.now() + '-' + moved.length)
    renameSync(dir, target)
    moved.push(target)
  }
  return jsonResponse({ ok: true, moved })
}

/** Claim the session-delete route when this host carries a browser connection. */
function registerSessionDeleteRoute(ctx) {
  ctx.inject(['connection'], (scope) => {
    const connection = scope.connection
    if (connection === undefined || connection.fetch === undefined || typeof connection.fetch.register !== 'function') return
    scope.effect(() => connection.fetch.register({
      path: '/api/icex-fixer/delete-session',
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: (request) => handleDeleteSession(request, scope),
    }), 'icex-dsh-fixer: session delete route')
  })
}

/*
 * Bare mode: turn every plugin off to show DSH as it ships, then turn them all
 * back on. Only bundle layers are deselected, so the Host services the app and
 * this plugin need stay mounted: dsh-base carries `pluginManager`, dsh-web-app
 * carries the stock Plugins page that the restore switch lives on, and this
 * bundle stays selected so its own switch survives. Before anything changes,
 * the enabled bundle names are written to a snapshot file; entering the mode
 * is therefore always reversible from the Plugins page, from a second browser,
 * and after a restart.
 */

/** Bundles bare mode never turns off; the plugin manager also refuses two of them. */
const BARE_PROTECTED = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'icex-dsh-fixer'])

/** The snapshot lives beside the other DSH state, one record per profile. */
const BARE_STATE_FILE = join(DSH_HOME, 'fixer', 'bare-mode.json')
const BARE_PROFILE = process.env.DSH_PROFILE ?? ''
let bareOperationRunning = false

/** One snapshot candidate as read from disk, or null when the file is unusable. */
function parseBareState(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  if (parsed.version !== 1 || parsed.profile !== BARE_PROFILE) return null
  if (!Array.isArray(parsed.bundles) || !parsed.bundles.every((name) => typeof name === 'string')) return null
  return {
    version: 1,
    profile: BARE_PROFILE,
    at: typeof parsed.at === 'string' ? parsed.at : '',
    bundles: parsed.bundles.slice(),
  }
}

/** Read the snapshot for this profile, falling back to the copy written beside it. */
function readBareState() {
  for (const file of [BARE_STATE_FILE, BARE_STATE_FILE + '.bak']) {
    let raw
    try {
      raw = readFileSync(file, 'utf8')
    } catch (error) {
      continue
    }
    const state = parseBareState(raw)
    if (state !== null) return state
  }
  return null
}

/**
 * Write the snapshot atomically: the previous file becomes the backup, and the
 * new one appears only when it is complete.
 */
function writeBareState(state) {
  mkdirSync(dirname(BARE_STATE_FILE), { recursive: true })
  const temp = BARE_STATE_FILE + '.' + String(process.pid) + '.tmp'
  writeFileSync(temp, JSON.stringify(state, null, 2) + '\n')
  try {
    renameSync(BARE_STATE_FILE, BARE_STATE_FILE + '.bak')
  } catch (error) {
    // The first write has no predecessor to keep.
  }
  renameSync(temp, BARE_STATE_FILE)
}

/** Forget the snapshot and its backup; a missing file is already the desired state. */
function clearBareState() {
  for (const file of [BARE_STATE_FILE, BARE_STATE_FILE + '.bak']) {
    try {
      unlinkSync(file)
    } catch (error) {
      // Nothing to clear.
    }
  }
}

/** The Host's plugin manager, when this profile mounted one. */
function bareManager(scope) {
  const manager = scope.pluginManager
  if (manager === undefined || manager === null) return null
  if (typeof manager.listBundles !== 'function' || typeof manager.setBundleEnabled !== 'function') return null
  return manager
}

/** Whether one listed bundle is a layer bare mode turns off. */
function isBareTarget(bundle) {
  return bundle.enabled === true
    && bundle.availability !== 'missing'
    && bundle.readOnlyReason === undefined
    && !BARE_PROTECTED.has(bundle.name)
}

/** The enabled bundle layers bare mode turns off, in profile order. */
async function bareTargets(manager) {
  const bundles = await manager.listBundles()
  return bundles.filter(isBareTarget)
}

/**
 * Turn one list of bundles on or off, retrying a refused layer once: a later
 * layer may still hold a service the bundle provided, and by then it is gone.
 * @returns failed attempts and the names whose change waits for a restart.
 */
async function setBundles(manager, names, enabled) {
  const failed = []
  const restartRequired = []
  /** @returns {Promise<string | null>} failure code, or null when the layer accepted the change */
  const attempt = async (name) => {
    try {
      const result = await manager.setBundleEnabled(name, enabled)
      if (result !== null && typeof result === 'object') {
        if (result.error !== undefined || result.application === 'failed') return result.error?.code ?? 'error'
        if (result.application === 'restart-required' && restartRequired.includes(name) === false) restartRequired.push(name)
      }
      return null
    } catch (error) {
      return 'exception'
    }
  }
  const rejected = []
  for (const name of names) {
    const code = await attempt(name)
    if (code !== null) rejected.push({ name, code })
  }
  for (const item of rejected) {
    const code = await attempt(item.name)
    if (code !== null) failed.push({ name: item.name, code })
  }
  return { failed, restartRequired }
}

/** Build the status reply from the snapshot and what the profile actually runs now. */
async function bareStatus(manager) {
  const bundles = await manager.listBundles()
  const candidates = bundles.filter(isBareTarget).length
  const state = readBareState()
  if (state === null) return { ok: true, active: false, snapshot: null, disabled: [], candidates }
  const remaining = state.bundles.filter((name) => {
    const bundle = bundles.find((candidate) => candidate.name === name)
    return bundle !== undefined && bundle.enabled === false
  })
  if (remaining.length === 0) {
    // The profile was restored elsewhere (the Plugins list, another browser,
    // a hand edit); the snapshot no longer describes it.
    clearBareState()
    return { ok: true, active: false, snapshot: null, disabled: [], candidates }
  }
  return {
    ok: true,
    active: true,
    snapshot: { at: state.at, count: state.bundles.length, bundles: state.bundles },
    disabled: remaining,
    candidates,
  }
}

/** Snapshot the enabled layers, then turn them off. The snapshot is written first. */
async function enterBareMode(manager) {
  const status = await bareStatus(manager)
  if (status.active === true) return status
  const targets = await bareTargets(manager)
  if (targets.length === 0) {
    return { ok: true, active: false, snapshot: null, disabled: [], note: 'no bundles to turn off' }
  }
  const state = {
    version: 1,
    profile: BARE_PROFILE,
    at: new Date().toISOString(),
    bundles: targets.map((bundle) => bundle.name),
  }
  // Anything that goes wrong after this point leaves a snapshot the restore
  // action can use, so fail before touching the profile.
  writeBareState(state)
  // Later layers go first: dependents release the services they held before
  // a lower layer they depend on is unloaded.
  const outcome = await setBundles(manager, state.bundles.slice().reverse(), false)
  if (outcome.failed.length > 0) {
    console.warn('[icex-dsh-fixer] bare mode kept these layers on: ' + outcome.failed.map((item) => item.name + '(' + item.code + ')').join(', '))
  }
  const after = await bareStatus(manager)
  return {
    ok: true,
    active: after.active,
    snapshot: after.snapshot,
    disabled: after.disabled,
    failed: outcome.failed,
    restartRequired: outcome.restartRequired,
  }
}

/** Re-enable every snapshotted layer that is off, in its recorded order. */
async function exitBareMode(manager) {
  const state = readBareState()
  if (state === null) return { ok: true, active: false, snapshot: null, disabled: [], failed: [] }
  const bundles = await manager.listBundles()
  const known = new Map(bundles.map((bundle) => [bundle.name, bundle]))
  // Missing packages were uninstalled since the snapshot; nothing can make
  // them run, and leaving them out keeps the restore honest.
  const targets = state.bundles.filter((name) => {
    const bundle = known.get(name)
    return bundle !== undefined && bundle.enabled === false && bundle.availability !== 'missing'
  })
  const outcome = await setBundles(manager, targets, true)
  const after = await bareStatus(manager)
  return {
    ok: true,
    active: after.active,
    snapshot: after.snapshot,
    disabled: after.disabled,
    failed: outcome.failed,
    restartRequired: outcome.restartRequired,
  }
}

/** Answer GET status and POST `{ action: 'on' | 'off' }` for bare mode. */
async function handleBareMode(request, scope) {
  const manager = bareManager(scope)
  if (manager === null) return jsonResponse({ ok: false, error: 'plugin manager is unavailable' }, 503)
  if (request.method === 'GET') {
    try {
      return jsonResponse(await bareStatus(manager))
    } catch (error) {
      return jsonResponse({ ok: false, error: String(error?.message ?? error) }, 500)
    }
  }
  let body
  try {
    body = await request.json()
  } catch (error) {
    return jsonResponse({ ok: false, error: 'body is not JSON' }, 400)
  }
  const action = body !== null && typeof body === 'object' ? body.action : undefined
  if (action !== 'on' && action !== 'off') {
    return jsonResponse({ ok: false, error: 'action must be "on" or "off"' }, 400)
  }
  if (bareOperationRunning) return jsonResponse({ ok: false, error: 'another change is in progress', code: 'busy' }, 409)
  bareOperationRunning = true
  try {
    return jsonResponse(action === 'on' ? await enterBareMode(manager) : await exitBareMode(manager))
  } catch (error) {
    console.warn('[icex-dsh-fixer] bare mode failed: ' + String(error?.message ?? error))
    return jsonResponse({ ok: false, error: String(error?.message ?? error) }, 500)
  } finally {
    bareOperationRunning = false
  }
}

/** Claim the bare-mode route; it needs the plugin manager as well as a browser. */
function registerBareModeRoute(ctx) {
  ctx.inject(['connection', 'pluginManager'], (scope) => {
    const connection = scope.connection
    if (connection === undefined || connection.fetch === undefined || typeof connection.fetch.register !== 'function') return
    scope.effect(() => connection.fetch.register({
      path: '/api/icex-fixer/bare-mode',
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: (request) => handleBareMode(request, scope),
    }), 'icex-dsh-fixer: bare mode route')
  })
}

apply.__test = {
  BARE_PROTECTED,
  handleDeleteSession,
  bareTargets,
  bareStatus,
  enterBareMode,
  exitBareMode,
  handleBareMode,
  readBareState,
  writeBareState,
  clearBareState,
  BARE_STATE_FILE,
}

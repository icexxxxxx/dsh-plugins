/**
 * Host half of icex-dsh-fixer: starts the macOS summon helper.
 *
 * The helper listens for a right-Option double tap and moves the DSH window to
 * the screen under the pointer. It lives outside the Web client because global
 * key events and native window bounds are not available to a browser plugin.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs'
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
async function handleDeleteSession(request) {
  let body
  try {
    body = await request.json()
  } catch (error) {
    return jsonResponse({ ok: false, error: 'body is not JSON' }, 400)
  }
  const id = typeof body?.id === 'string' ? body.id.trim() : ''
  if (id === '') return jsonResponse({ ok: false, error: 'id is required' }, 400)

  const sessions = request.ctx?.get?.('sessions')
  try {
    if (sessions !== undefined && typeof sessions.get === 'function' && sessions.get(id) !== undefined) {
      return jsonResponse({ ok: false, error: 'session is open; close it first', code: 'live' }, 409)
    }
  } catch (error) {
    // A registry probe must never block deletion of a closed session.
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
  const connection = ctx.get('connection')
  if (connection === undefined || connection.fetch === undefined || typeof connection.fetch.register !== 'function') return
  ctx.effect(() => connection.fetch.register({
    path: '/api/icex-fixer/delete-session',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: (request) => handleDeleteSession(request),
  }), 'icex-dsh-fixer: session delete route')
}

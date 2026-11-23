#!/usr/bin/env node
/**
 * Headless test for the fixer's session-delete route: a running session is
 * stopped and archived before its log moves, and every refusal leaves the
 * log where it was. No DSH runtime needed.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-fixer-delete-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'test'
const { apply } = await import('../packages/fixer/index.js')
const t = apply.__test

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name + (detail === undefined ? '' : ' (' + detail + ')'))
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}

const sessionsRoot = join(home, 'sessions')
const trashRoot = join(home, 'trash', 'sessions')
const project = 'project-a'

/** One session log directory and the ctx that must find it. */
function makeSession(id) {
  const dir = join(sessionsRoot, project, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'log.jsonl'), '{"type":"header"}\n')
  return dir
}

function makeCtx(options = {}) {
  const calls = { archive: [], flush: [] }
  const sessions = {
    get: (id) => (options.live !== undefined && options.live.includes(id) ? { id } : undefined),
    flush: async (session) => {
      calls.flush.push(session.id)
      if (options.flushThrows === true) throw new Error('flush failed')
    },
  }
  const workspaceRegistry = options.workspace === false
    ? undefined
    : {
        archiveSession: async (id, archiveOptions) => {
          calls.archive.push({ id, options: archiveOptions })
          if (options.archiveThrows === true) throw new Error('archive failed')
        },
      }
  const ctx = {
    get: (name) => {
      if (name === 'sessions') return sessions
      if (name === 'workspaceRegistry') return workspaceRegistry
      return undefined
    },
  }
  return { ctx, calls }
}

const request = (body) => new Request('http://127.0.0.1/api/icex-fixer/delete-session', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

// 1. a closed session moves without touching the workspace registry
let dir = makeSession('session-closed')
let harness = makeCtx()
let response = await t.handleDeleteSession(request({ id: 'session-closed' }), harness.ctx)
let body = await response.json()
check('moves a closed session', response.status === 200 && body.ok === true && body.moved.length === 1, JSON.stringify(body))
check('closed session leaves the original path', existsSync(dir) === false)
check('closed session does not archive', harness.calls.archive.length === 0)
check('closed session does not flush', harness.calls.flush.length === 0)
check('moved log is readable in the trash', body.ok === true && existsSync(join(body.moved[0], 'log.jsonl')))

// 2. a running session is archived with stopActivity, flushed, then moved
dir = makeSession('session-live')
harness = makeCtx({ live: ['session-live'] })
response = await t.handleDeleteSession(request({ id: 'session-live' }), harness.ctx)
body = await response.json()
check('deletes a running session', response.status === 200 && body.ok === true, JSON.stringify(body))
check('archives with stopActivity before moving', JSON.stringify(harness.calls.archive) === JSON.stringify([{ id: 'session-live', options: { stopActivity: true } }]), JSON.stringify(harness.calls.archive))
check('flushes the running session', JSON.stringify(harness.calls.flush) === JSON.stringify(['session-live']))
check('running session log moved', existsSync(dir) === false && body.moved.length === 1)

// 3. no workspace registry means no safe stop: refuse and keep the log
dir = makeSession('session-live-noworkspace')
harness = makeCtx({ live: ['session-live-noworkspace'], workspace: false })
response = await t.handleDeleteSession(request({ id: 'session-live-noworkspace' }), harness.ctx)
body = await response.json()
check('refuses a running session without a stop path', response.status === 409 && body.code === 'live', JSON.stringify(body))
check('refused session keeps its log', existsSync(dir) === true)
check('refused session is not archived', harness.calls.archive.length === 0)

// 4. a stop failure refuses without moving anything
dir = makeSession('session-stop-fails')
harness = makeCtx({ live: ['session-stop-fails'], archiveThrows: true })
response = await t.handleDeleteSession(request({ id: 'session-stop-fails' }), harness.ctx)
body = await response.json()
check('stop failure is a live refusal', response.status === 409 && body.code === 'live', JSON.stringify(body))
check('stop failure keeps the log', existsSync(dir) === true)
check('stop failure does not flush', harness.calls.flush.length === 0)

// 5. a failed flush is logged but still deletes
dir = makeSession('session-flush-fails')
harness = makeCtx({ live: ['session-flush-fails'], flushThrows: true })
response = await t.handleDeleteSession(request({ id: 'session-flush-fails' }), harness.ctx)
body = await response.json()
check('failed flush still deletes', response.status === 200 && body.ok === true, JSON.stringify(body))
check('failed flush still moves the log', existsSync(dir) === false)

// 6. missing logs and malformed requests
harness = makeCtx()
response = await t.handleDeleteSession(request({ id: 'session-missing' }), harness.ctx)
check('missing log is a 404', response.status === 404, response.status)
response = await t.handleDeleteSession(request({}), harness.ctx)
check('missing id is a 400', response.status === 400, response.status)
response = await t.handleDeleteSession(new Request('http://127.0.0.1/api/icex-fixer/delete-session', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
}), harness.ctx)
check('non-JSON body is a 400', response.status === 400, response.status)

// The test project directories remain under the temp home; clean up.
rmSync(home, { recursive: true, force: true })
console.log(failures.length === 0 ? 'FIXER DELETE OK' : failures.length + ' FAILED')
process.exit(failures.length === 0 ? 0 : 1)

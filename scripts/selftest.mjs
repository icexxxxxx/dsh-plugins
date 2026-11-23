#!/usr/bin/env node
/**
 * Self-test for both packages: syntax, memory store behaviour, consolidation.
 * Exits non-zero on the first failed assertion. No network, no DSH runtime needed.
 */
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-selftest-'))
const m = await import(join(root, 'packages/memory/index.js'))
mkdirSync(m.HOME, { recursive: true })

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name + (detail === undefined ? '' : ' (' + detail + ')'))
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}

// memory: add / digest / dedupe / search / replace / forget
const store = join(m.HOME, 'MEMORY.md')
const first = m.makeEntry('回答要结论先行', 'pref', 'selftest@1')
m.appendEntry(store, first)
check('digest includes fact', m.renderDigest('/tmp/selftest').includes('回答要结论先行'))
check('parse roundtrip', m.parseEntries(readFileSync(store, 'utf8'))[0].id === first.id)
check('duplicate similarity', m.similarity('回答要结论先行', '回答要结论先行。') >= 0.85)
check('secret rejected', (() => { try { m.makeEntry('api_key=abcd1234efgh', 'pref', 'x'); return false } catch { return true } })())
check('search finds fact', m.searchEntries(m.parseEntries(readFileSync(store, 'utf8')), '结论', 5).length === 1)


// consolidation: dedupe + archive, prose preserved
const c = join(m.HOME, 'C.md')
writeFileSync(c, '# notes\nkeep this prose\n')
m.appendEntry(c, m.makeEntry('今天要用 pnpm 安装', 'tool', 's@1'))
m.appendEntry(c, m.makeEntry('今天要用 pnpm 安装。', 'tool', 's@2'))
const report = m.consolidateFile(c, { maxEntries: 100, dedupe: 0.85 })
check('consolidate merges', report.merged === 1, report.merged)
check('prose preserved', readFileSync(c, 'utf8').includes('keep this prose'))
check('archive written', readFileSync(m.archivePath(c), 'utf8').includes('pnpm'))


// candidate capture: durable-looking user messages queue for the next session
check('durable message is captured', m.looksDurable('以后所有回答都要先给结论') === true)
check('task message is not captured', m.looksDurable('帮我把这个文件读一下') === false)
check('context message is not captured', m.looksDurable('<system-reminder>以后</system-reminder>') === false)

const queued = m.captureCandidate('以后所有回答都要先给结论', '/tmp/selftest', 'selftest@1')
check('candidate is queued', queued !== null && m.readPending().some((entry) => entry.id === queued.id))
check('candidate is deduplicated', m.captureCandidate('以后所有回答都要先给结论', '/tmp/selftest', 'selftest@1') === null)
check('digest shows candidates', m.renderDigest('/tmp/selftest').includes('[candidates]'))
check('dismiss removes a candidate', m.dismissCandidate(queued.id) === true && m.readPending().every((entry) => entry.id !== queued.id))

m.captureCandidate('以后所有回答都要先给结论', '/tmp/selftest', 'selftest@1')
const promoted = m.makeEntry('以后所有回答都要先给结论', 'pref', 'selftest@2')
m.appendEntry(store, promoted)
m.dropMatchingCandidate(promoted.text)
check('promotion drops a similar candidate', m.readPending().length === 0)

// model verdicts: recorded, shown in the digest, auto-applied when unchallenged
m.writePending([])
const judged = m.captureCandidate('以后所有回答都要先给结论', '/tmp/selftest', 'selftest@9')
check('verdict is recorded', m.decideCandidate(judged.id, 'promote', '用户明确要求') === true)
const judgedEntry = m.readPending().find((entry) => entry.id === judged.id)
check('verdict keeps the reason', judgedEntry?.decision?.action === 'promote' && judgedEntry.decision.reason === '用户明确要求')
check('digest shows the verdict', m.renderDigest('/tmp/selftest').includes('model suggests promote'))
const fresh = m.applyDueDecisions(24)
check('fresh verdict is not applied yet', fresh.promoted === 0 && m.readPending().length === 1)
judgedEntry.decision.at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()
m.writePending([judgedEntry])
const due = m.applyDueDecisions(24)
check('stale verdict is applied', due.promoted === 1 && m.readPending().length === 0)
check('applied verdict wrote a fact', m.parseEntries(readFileSync(store, 'utf8')).some((entry) => entry.text.includes('以后所有回答都要先给结论')))

// sidebar panel: payload and candidate actions
m.writePending([])
const panelCandidate = m.captureCandidate('以后回答都要先给结论', '/tmp/selftest', 'selftest@11')
m.decideCandidate(panelCandidate.id, 'promote', '用户明确要求')
const panel = await m.handlePanelRequest(new Request('http://127.0.0.1/api/icex-memory/panel'), undefined)
const panelBody = await panel.json()
check('panel lists candidates with verdicts', panel.ok === true && panelBody.candidates.length === 1 && panelBody.candidates[0].decision.action === 'promote')
check('panel reports digest stats', typeof panelBody.stats.digestChars === 'number' && panelBody.stats.candidates === 1)

const promotedPanel = await m.handlePanelRequest(new Request('http://127.0.0.1/api/icex-memory/panel', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'promote', id: panelCandidate.id }),
}), undefined)
check('panel promotes a candidate', (await promotedPanel.json()).ok === true && m.readPending().length === 0)

// panel editing of stored entries
const editable = m.makeEntry('面板里可编辑的条目', 'pref', 'selftest@12')
m.appendEntry(store, editable)
const updated = await m.handlePanelRequest(new Request('http://127.0.0.1/api/icex-memory/panel', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'update', id: editable.id, text: '面板里可编辑的条目（已改）' }),
}), undefined)
check('panel updates an entry', (await updated.json()).ok === true && readFileSync(store, 'utf8').includes('（已改）'))
const removed = await m.handlePanelRequest(new Request('http://127.0.0.1/api/icex-memory/panel', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ action: 'delete', id: editable.id }),
}), undefined)
check('panel deletes an entry', (await removed.json()).ok === true && !readFileSync(store, 'utf8').includes('（已改）'))

// settings-page editor: route registration, read, write, guards
const registeredRoutes = []
const fakeConnection = {
  fetch: { register: (route) => { registeredRoutes.push(route); return () => {} } },
}
const fakeCtx = {
  get: (key) => (key === 'connection' ? fakeConnection : undefined),
  inject: (names, callback) => callback({ connection: fakeConnection, effect: (fn) => fn() }),
  effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
  systemPrompt: { section: () => {} },
  on: () => {},
  logger: { info: () => {}, warn: () => {} },
}
m.apply(fakeCtx, {})
check('editor route registered', registeredRoutes.some((route) => route.path === '/api/icex-memory' && route.methods.includes('POST')))
check('panel route registered', registeredRoutes.some((route) => route.path === '/api/icex-memory/panel' && route.methods.includes('GET')))

const readBack = await m.handleEditorRequest(new Request('http://127.0.0.1/api/icex-memory?scope=global'))
const readBody = await readBack.json()
check('editor reads store', readBack.status === 200 && readBody.ok === true && readBody.text.includes('回答要结论先行'))

const writeBack = await m.handleEditorRequest(new Request('http://127.0.0.1/api/icex-memory?scope=global', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: '- [pref] 编辑后的内容 <!-- id=abc123 src=manual at=2026-11-20 -->\n' }),
}))
check('editor writes store', writeBack.status === 200 && readFileSync(store, 'utf8').includes('编辑后的内容'))

const secretWrite = await m.handleEditorRequest(new Request('http://127.0.0.1/api/icex-memory?scope=global', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'api_key=abcd1234efgh' }),
}))
check('editor rejects credentials', secretWrite.status === 400)

const homeProject = await m.handleEditorRequest(new Request('http://127.0.0.1/api/icex-memory?scope=project&dir=~'))
check('project scope expands ~', homeProject.status === 200)

const emptyProject = await m.handleEditorRequest(new Request('http://127.0.0.1/api/icex-memory?scope=project&dir='))
check('empty project dir is refused', emptyProject.status === 400)

const relativeProject = await m.handleEditorRequest(new Request('http://127.0.0.1/api/icex-memory?scope=project&dir=relative/path'))
check('project scope needs absolute dir', relativeProject.status === 400)

console.log(failures.length === 0 ? 'SELFTEST OK' : failures.length + ' FAILED')
process.exit(failures.length === 0 ? 0 : 1)

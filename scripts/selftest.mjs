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


// settings-page editor: route registration, read, write, guards
let captured = null
const fakeConnection = {
  fetch: { register: (route) => { captured = route; return () => {} } },
}
const fakeCtx = {
  get: (key) => (key === 'connection' ? fakeConnection : undefined),
  effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
  systemPrompt: { section: () => {} },
  on: () => {},
  logger: { info: () => {}, warn: () => {} },
}
m.apply(fakeCtx, {})
check('editor route registered', captured !== null && captured.path === '/api/icex-memory' && captured.methods.includes('POST'))

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

const relativeProject = await m.handleEditorRequest(new Request('http://127.0.0.1/api/icex-memory?scope=project&dir=relative/path'))
check('project scope needs absolute dir', relativeProject.status === 400)

console.log(failures.length === 0 ? 'SELFTEST OK' : failures.length + ' FAILED')
process.exit(failures.length === 0 ? 0 : 1)

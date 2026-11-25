/**
 * Unit checks for icex-dsh-plugin-center: config normalisation, the update
 * check/update/install flows against a fake PluginManager, and the client
 * helpers loaded through a stub module factory. Run with node scripts/test-plugin-center.mjs.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'icex-plugin-center-'))
process.env.DSH_HOME = home

let passed = 0
function check(name, run) {
  try {
    run()
    passed += 1
    console.log('PASS ' + name)
  } catch (error) {
    console.error('FAIL ' + name)
    throw error
  }
}

const host = await import('../packages/plugin-center/index.js')
const t = host.__test

check('interval is clamped and unknown packages are dropped', () => {
  const config = t.normaliseConfig({
    autoUpdate: { enabled: true, intervalHours: 0, packages: { 'icex-dsh-fixer': true, evil: true, 'icex-dsh-memory': false } },
  })
  assert.equal(config.autoUpdate.enabled, true)
  assert.equal(config.autoUpdate.intervalHours, 1)
  assert.deepEqual(config.autoUpdate.packages, { 'icex-dsh-fixer': true })
  assert.equal(t.normaliseConfig({ autoUpdate: { intervalHours: 999 } }).autoUpdate.intervalHours, 168)
  assert.equal(t.normaliseConfig(null).autoUpdate.enabled, false)
})

check('only icex packages are managed', () => {
  assert.equal(t.own('icex-dsh-fixer'), true)
  assert.equal(t.own('dshmarket'), false)
  assert.equal(t.own(undefined), false)
})

function fakeManager({ bundles, versions = {}, update } = {}) {
  const calls = { listVersions: [], updateBundle: [], installBundle: [], remove: [] }
  return {
    calls,
    async listBundles() {
      return bundles
    },
    async listVersions(name) {
      calls.listVersions.push(name)
      const value = versions[name]
      if (value === undefined) return { status: 'refused', problem: 'network', reason: 'offline', attempts: [] }
      return { status: 'listed', installed: '0.0.0', registry: 'https://registry.npmjs.org', attempts: [], omitted: 0, versions: value }
    },
    async updateBundle(name, version, options) {
      calls.updateBundle.push({ name, version, options })
      return update ?? { from: '0.3.11', to: version, step: 'install', result: { application: 'restart-required' } }
    },
    async installBundle(spec, options) {
      calls.installBundle.push({ spec, options })
      return { changed: true, application: 'restart-required', stage: 'install', target: spec }
    },
    async removeBundle(name) {
      calls.remove.push(name)
      return { changed: true, application: 'applied', stage: 'remove', target: name }
    },
  }
}

const installed = [
  { name: 'icex-dsh-fixer', installed: true, enabled: true, update: 'registry', version: '0.3.11', description: 'fixer' },
  { name: 'icex-dsh-memory', installed: false, enabled: false, update: undefined, version: undefined, description: 'memory' },
  { name: 'dshmarket', installed: true, enabled: true, update: 'registry', version: '1.80.0' },
]

check('checkAll skips incompatible and non-icex versions', async () => {
  const manager = fakeManager({
    bundles: installed,
    versions: {
      'icex-dsh-fixer': [
        { version: '0.4.0', bundle: true, incompatible: { name: 'dsh' } },
        { version: '0.3.12', bundle: true },
        { version: '0.3.11', bundle: true },
      ],
    },
  })
  const result = await t.checkAll(manager)
  assert.deepEqual(Object.keys(result.updates), ['icex-dsh-fixer'])
  assert.equal(result.updates['icex-dsh-fixer'].latest, '0.3.12')
  assert.equal(result.updates['icex-dsh-fixer'].installed, '0.3.11')
  assert.deepEqual(Object.keys(result.failed), [])
  assert.equal(result.checked, 1)
})

check('checkAll records one package failure without throwing', async () => {
  const manager = fakeManager({ bundles: installed, versions: {} })
  const result = await t.checkAll(manager)
  assert.deepEqual(Object.keys(result.updates), [])
  assert.match(result.failed['icex-dsh-fixer'], /offline/)
})

check('updateOne passes the registry and a request id', async () => {
  const manager = fakeManager({
    bundles: installed,
    versions: { 'icex-dsh-fixer': [{ version: '0.3.12', bundle: true }] },
  })
  const result = await t.updateOne(manager, 'icex-dsh-fixer')
  assert.equal(result.status, 'updated')
  assert.equal(result.from, '0.3.11')
  assert.equal(result.to, '0.3.12')
  assert.equal(manager.calls.updateBundle[0].version, '0.3.12')
  assert.equal(manager.calls.updateBundle[0].options.registry, 'https://registry.npmjs.org')
  assert.match(manager.calls.updateBundle[0].options.requestId, /^[0-9a-f-]{36}$/)
})

check('updateOne reports current when nothing newer exists', async () => {
  const manager = fakeManager({ bundles: installed, versions: { 'icex-dsh-fixer': [] } })
  const result = await t.updateOne(manager, 'icex-dsh-fixer')
  assert.deepEqual(result, { status: 'current', version: '0.3.11' })
  assert.equal(manager.calls.updateBundle.length, 0)
})

check('updateOne refuses a bundle that is not installed', async () => {
  const manager = fakeManager({ bundles: installed })
  await assert.rejects(() => t.updateOne(manager, 'icex-dsh-memory'), /尚未安装/)
})

check('installOne passes enabled and a request id', async () => {
  const manager = fakeManager({ bundles: installed, versions: {} })
  const result = await t.installOne(manager, 'icex-dsh-memory')
  assert.equal(result.application, 'restart-required')
  assert.equal(manager.calls.installBundle[0].spec, 'icex-dsh-memory')
  assert.equal(manager.calls.installBundle[0].options.enabled, true)
  assert.match(manager.calls.installBundle[0].options.requestId, /^[0-9a-f-]{36}$/)
})

check('installOne refuses an already installed bundle', async () => {
  const manager = fakeManager({ bundles: installed })
  await assert.rejects(() => t.installOne(manager, 'icex-dsh-fixer'), /已经安装/)
})

check('readState lists the catalog first and marks absent entries', async () => {
  const manager = fakeManager({ bundles: installed })
  const state = await t.readState(manager)
  assert.equal(state.ok, true)
  assert.deepEqual(
    state.bundles.map((item) => item.name),
    ['icex-dsh-fixer', 'icex-dsh-memory', 'icex-dsh-plugin-center'],
  )
  const memory = state.bundles.find((item) => item.name === 'icex-dsh-memory')
  assert.equal(memory.installed, false)
  assert.equal(memory.self, false)
  assert.equal(state.bundles.find((item) => item.name === 'icex-dsh-plugin-center').self, true)
})

check('autoUpdatePass updates only enabled packages and records the check', async () => {
  t.writeConfig({
    version: 1,
    autoUpdate: { enabled: true, intervalHours: 6, packages: { 'icex-dsh-fixer': true } },
    lastCheck: null,
  })
  const manager = fakeManager({
    bundles: [installed[0], installed[2]],
    versions: {
      'icex-dsh-fixer': [{ version: '0.3.12', bundle: true }],
      'icex-dsh-plugin-center': [{ version: '9.9.9', bundle: true }],
    },
  })
  const results = await t.autoUpdatePass(manager)
  assert.equal(results.length, 1)
  assert.equal(results[0].name, 'icex-dsh-fixer')
  assert.equal(results[0].ok, true)
  assert.equal(manager.calls.updateBundle.length, 1)
  const saved = JSON.parse(readFileSync(join(home, 'plugin-center', 'config.json'), 'utf8'))
  assert.equal(saved.lastCheck.automatic, true)
  assert.equal(saved.lastCheck.updates['icex-dsh-fixer'].latest, '0.3.12')
})

check('autoUpdatePass does nothing while auto update is off', async () => {
  t.writeConfig({ version: 1, autoUpdate: { enabled: false, intervalHours: 6, packages: { 'icex-dsh-fixer': true } }, lastCheck: null })
  const manager = fakeManager({ bundles: installed })
  assert.equal(await t.autoUpdatePass(manager), null)
  assert.equal(manager.calls.updateBundle.length, 0)
})

// ---- client helpers, loaded through a stub module factory -------------------
let clientPlugin = null
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useState: (value) => [value, () => {}],
}
globalThis.__ICEX_PLUGIN_CENTER_TEST__ = true
globalThis.window = {
  __ModuleLoader__: {
    load({ id, factory }) {
      assert.equal(id, 'icex-dsh-plugin-center')
      clientPlugin = factory((name) => {
        if (name === 'react') return reactStub
        if (name === '@deepseek-ai/dsh-client-ui-primitives') return { IconPluginPinwheelOutlineRegular: () => null }
        throw new Error('unexpected module: ' + name)
      })
    },
  },
}
await import('../packages/plugin-center/client.js')
delete globalThis.window
delete globalThis.__ICEX_PLUGIN_CENTER_TEST__

check('client helpers format names and status', () => {
  const c = clientPlugin.__test
  assert.equal(c.shortName('icex-dsh-fixer'), 'Fixer')
  assert.equal(c.shortName('icex-dsh-plugin-center'), 'Plugin Center')
  assert.equal(c.statusOf({ installed: true, enabled: true }), 'running')
  assert.equal(c.statusOf({ installed: true, enabled: false }), 'stopped')
  assert.equal(c.statusOf({ installed: false }), 'absent')
  assert.equal(c.format('{a} + {b}', { a: 1, b: 2 }), '1 + 2')
  assert.equal(c.patchConfig({ autoUpdate: { enabled: false, intervalHours: 6, packages: {} } }, { packages: { x: true } }).autoUpdate.packages.x, true)
})

check('client registers the sidebar entry and the main page', () => {
  const registrations = []
  const injected = []
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => {}, bind: () => (key) => key },
    slots: {
      inject: (name, fn) => {
        injected.push(name)
        fn()
      },
      register: (options) => {
        registrations.push(options)
        return options
      },
    },
  }
  clientPlugin.apply(ctx)
  assert.deepEqual(injected, ['main', 'sidebar.panellist'])
  assert.equal(registrations[0].name, 'main')
  assert.equal(registrations[0].key, 'icex-plugins')
  assert.equal(registrations[1].name, 'sidebar.panellist')
  assert.equal(registrations[1].id, 'icex-plugins')
})

check('client styles define the page and switch surfaces', () => {
  const css = clientPlugin.__test.STYLE_LINES.join('\n')
  for (const selector of ['.icex-pc', '.icex-pc-card', '.icex-pc-switch', '.icex-pc-btn-primary', '.icex-pc-toast']) {
    assert.ok(css.includes(selector), 'missing ' + selector)
  }
})

rmSync(home, { recursive: true, force: true })
console.log('PLUGIN CENTER TEST OK (' + passed + ' checks)')

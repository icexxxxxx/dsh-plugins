#!/usr/bin/env node
/**
 * Headless test for the fixer host's bare mode: snapshot order, the disable and
 * restore calls, the retry pass, missing packages, and the route contract.
 * No DSH runtime needed.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-fixer-bare-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'test'
const { apply } = await import('../packages/fixer/index.js')
const t = apply.__test

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name + (detail === undefined ? '' : ' (' + detail + ')'))
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}

const statePath = join(home, 'fixer', 'bare-mode.json')
check('state file is inside the DSH home', t.BARE_STATE_FILE === statePath, t.BARE_STATE_FILE)

const PROFILE = [
  ['@deepseek-ai/dsh-base', true, 'management-required'],
  ['@deepseek-ai/dsh-web-app', true, 'management-required'],
  ['third-a', true],
  ['third-b', true],
  ['icex-dsh-fixer', true],
  ['icex-dsh-memory', true],
  ['third-off', false],
  ['third-missing', true, undefined, 'missing'],
]

function makeManager(options = {}) {
  const entries = new Map(PROFILE.map(([name, enabled, readOnlyReason, availability]) => [name, {
    name,
    enabled,
    availability: availability ?? 'profile',
    readOnlyReason,
    rows: [],
    overrides: [],
  }]))
  const calls = []
  const refusals = new Map(options.refusals ?? [])
  return {
    calls,
    entries,
    async listBundles() {
      const listed = options.listing ?? entries
      return [...listed.values()].map((entry) => ({ ...entry }))
    },
    async setBundleEnabled(name, enabled) {
      calls.push([name, enabled])
      const entry = entries.get(name)
      if (entry === undefined) return { application: 'failed', error: { code: 'unknown-plugin' } }
      const remaining = refusals.get(name) ?? 0
      if (remaining > 0) {
        refusals.set(name, remaining - 1)
        return { application: 'failed', error: { code: 'bundle-in-use' } }
      }
      entry.enabled = enabled
      return { application: 'applied', changed: true }
    },
  }
}

const names = (calls) => calls.map(([name, enabled]) => name + (enabled ? '+' : '-')).join(',')

// 1. enter: snapshot first, later layers first, protected and missing untouched
let manager = makeManager()
const entered = await t.enterBareMode(manager)
const snapshot = JSON.parse(readFileSync(statePath, 'utf8'))
check('snapshot records the enabled non-core layers', JSON.stringify(snapshot.bundles) === JSON.stringify(['third-a', 'third-b', 'icex-dsh-memory']), JSON.stringify(snapshot.bundles))
check('snapshot carries the profile name', snapshot.profile === 'test', snapshot.profile)
check('snapshot is versioned and timed', snapshot.version === 1 && typeof snapshot.at === 'string' && snapshot.at.length > 0)
check('turns layers off in reverse profile order', names(manager.calls) === 'icex-dsh-memory-,third-b-,third-a-', names(manager.calls))
check('reports active with a count', entered.active === true && entered.snapshot.count === 3, JSON.stringify(entered))
check('reports the disabled layers', JSON.stringify(entered.disabled) === JSON.stringify(['third-a', 'third-b', 'icex-dsh-memory']), JSON.stringify(entered.disabled))
check('never touches core or the fixer', manager.calls.every(([name]) => name !== '@deepseek-ai/dsh-base' && name !== '@deepseek-ai/dsh-web-app' && name !== 'icex-dsh-fixer'))
check('leaves missing packages alone', manager.calls.some(([name]) => name === 'third-missing') === false)
check('leaves an already disabled layer alone', manager.calls.some(([name]) => name === 'third-off') === false)
check('the core still runs', manager.entries.get('@deepseek-ai/dsh-base').enabled === true && manager.entries.get('@deepseek-ai/dsh-web-app').enabled === true)
check('the fixer still runs', manager.entries.get('icex-dsh-fixer').enabled === true)

// 2. entering again is a no-op
const before = manager.calls.length
const again = await t.enterBareMode(manager)
check('a second enter does not toggle again', manager.calls.length === before && again.active === true)

// 3. status reads the snapshot and the live profile
manager = makeManager()
await t.enterBareMode(manager)
const status = await t.bareStatus(manager)
check('status is active with the remaining layers', status.active === true && status.disabled.length === 3, JSON.stringify(status))
check('status exposes the snapshot count', status.snapshot.count === 3, status.snapshot.count)

// 3b. a corrupt snapshot falls back to the copy written beside it
t.writeBareState({ version: 1, profile: 'test', at: 'first', bundles: ['third-a'] })
t.writeBareState({ version: 1, profile: 'test', at: 'second', bundles: ['third-b'] })
writeFileSync(statePath, '{not json')
const fallback = t.readBareState()
check('reads the backup when the snapshot is corrupt', fallback !== null && fallback.at === 'first', JSON.stringify(fallback))
t.clearBareState()
check('clearing removes the backup too', existsSync(statePath + '.bak') === false)

// 4. a stale snapshot clears itself once nothing is off
const manual = makeManager()
await t.enterBareMode(manual)
for (const entry of manual.entries.values()) entry.enabled = true
const cleared = await t.bareStatus(manual)
check('status clears a snapshot the profile no longer matches', cleared.active === false && existsSync(statePath) === false)

// 5. a refused layer is retried once and then accepted
manager = makeManager({ refusals: [['third-b', 1]] })
const retried = await t.enterBareMode(manager)
check('retries a refused layer after the others are gone', JSON.stringify(retried.failed) === '[]' && manager.entries.get('third-b').enabled === false, JSON.stringify(retried.failed))
check('the retried layer is reported as disabled', retried.disabled.includes('third-b'))

// 6. a layer that always refuses is reported, and the rest still change
manager = makeManager({ refusals: [['third-b', 99]] })
const partial = await t.enterBareMode(manager)
check('reports the layer that stayed on', partial.failed.length === 1 && partial.failed[0].name === 'third-b', JSON.stringify(partial.failed))
check('keeps the rest off', manager.entries.get('third-a').enabled === false && manager.entries.get('icex-dsh-memory').enabled === false)
check('stays active while something is off', partial.active === true)
check('the failed layer is not listed as disabled', partial.disabled.includes('third-b') === false, JSON.stringify(partial.disabled))

// 7. restore turns the snapshot back on in its recorded order and clears the file
manager = makeManager()
await t.enterBareMode(manager)
manager.calls.length = 0
const restored = await t.exitBareMode(manager)
check('restores in recorded order', names(manager.calls) === 'third-a+,third-b+,icex-dsh-memory+', names(manager.calls))
check('restore reports inactive', restored.active === false && restored.failed.length === 0, JSON.stringify(restored))
check('restore clears the snapshot file', existsSync(statePath) === false)
check('everything but the originally disabled layer runs again', manager.entries.get('third-a').enabled === true && manager.entries.get('icex-dsh-memory').enabled === true && manager.entries.get('third-off').enabled === false)

// 8. restoring with nothing to do is harmless
manager.calls.length = 0
const empty = await t.exitBareMode(manager)
check('restore without a snapshot is a no-op', manager.calls.length === 0 && empty.active === false, JSON.stringify(empty))

// 9. a snapshot naming a package that is gone skips it
manager = makeManager()
await t.enterBareMode(manager)
manager.calls.length = 0
const listing = new Map(manager.entries)
listing.delete('third-b')
const shrunk = makeManager({ listing })
for (const [name, entry] of listing) shrunk.entries.set(name, entry)
const skip = await t.exitBareMode(shrunk)
check('skips a snapshot entry that is no longer listed', skip.failed.length === 0 && shrunk.calls.every(([name]) => name !== 'third-b'), names(shrunk.calls))
check('restores the rest around the missing package', shrunk.entries.get('third-a').enabled === true && shrunk.entries.get('icex-dsh-memory').enabled === true)

// 10. the route contract
manager = makeManager()
const scope = { pluginManager: manager }
const readStatus = await t.handleBareMode(new Request('http://127.0.0.1/api/icex-fixer/bare-mode'), scope)
const statusBody = await readStatus.json()
check('GET without a snapshot is inactive', statusBody.active === false)
check('GET reports how many layers the switch would close', statusBody.candidates === 3, statusBody.candidates)
const turnOn = await t.handleBareMode(new Request('http://127.0.0.1/api/icex-fixer/bare-mode', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'on' }),
}), scope)
check('POST on enters bare mode', (await turnOn.json()).active === true)
const readOn = await t.handleBareMode(new Request('http://127.0.0.1/api/icex-fixer/bare-mode'), scope)
check('GET reports the active snapshot', (await readOn.json()).snapshot.count === 3)
const turnOff = await t.handleBareMode(new Request('http://127.0.0.1/api/icex-fixer/bare-mode', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'off' }),
}), scope)
check('POST off restores', (await turnOff.json()).active === false)
const badAction = await t.handleBareMode(new Request('http://127.0.0.1/api/icex-fixer/bare-mode', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'delete' }),
}), scope)
check('refuses an unknown action', badAction.status === 400)
const badJson = await t.handleBareMode(new Request('http://127.0.0.1/api/icex-fixer/bare-mode', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: 'not json',
}), scope)
check('refuses a non-JSON body', badJson.status === 400)
const noManager = await t.handleBareMode(new Request('http://127.0.0.1/api/icex-fixer/bare-mode'), {})
check('answers 503 without the plugin manager', noManager.status === 503)

rmSync(home, { recursive: true, force: true })
console.log(failures.length === 0 ? 'FIXER BARE OK' : failures.length + ' FAILED')
process.exit(failures.length === 0 ? 0 : 1)

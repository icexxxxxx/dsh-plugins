#!/usr/bin/env node
/**
 * Headless test for the fixer client's bare-mode surface: the browser mirror,
 * the settings switch (confirm, POST, reload), and the pieces bare mode hides.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'packages/fixer/client.js'), 'utf8')

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name + (detail === undefined ? '' : ' (' + detail + ')'))
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}

const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
  Fragment: Symbol('Fragment'),
  useCallback: (fn) => fn,
  useEffect: () => {},
  useLayoutEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useState: (initial) => {
    const value = typeof initial === 'function' ? initial() : initial
    return [value, (next) => { state.setters.push(next) }]
  },
  useSyncExternalStore: (_subscribe, get) => get(),
}
const primitives = {
  MenuItemButton: (props) => ({ type: 'MenuItemButton', props }),
  IconTrashOutlineRegular: () => ({ type: 'Icon' }),
}
const requireStub = (name) => {
  if (name === 'react') return react
  if (name === 'react-dom') return { createPortal: (node) => node }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error('unexpected require: ' + name)
}

const state = { confirms: true, alerts: [], reloads: 0, fetches: [], toggles: [], store: {}, setters: [] }
globalThis.__ICEX_FIXER_TEST__ = true
globalThis.window = {
  __ModuleLoader__: {
    load: (plugin) => {
      globalThis.__fixerPlugin = plugin.factory(requireStub)
    },
  },
  confirm: () => state.confirms,
  alert: (message) => state.alerts.push(message),
  location: { reload: () => { state.reloads += 1 } },
  localStorage: {
    getItem: (key) => (Object.hasOwn(state.store, key) ? state.store[key] : null),
    setItem: (key, value) => { state.store[key] = value },
    removeItem: (key) => { delete state.store[key] },
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  innerHeight: 900,
}
globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {}, style: {} }),
  head: { appendChild: () => {} },
  documentElement: {
    toggleAttribute: (name, on) => state.toggles.push([name, on]),
    removeAttribute: () => {},
    setAttribute: () => {},
  },
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  body: { appendChild: () => {}, removeChild: () => {} },
}
globalThis.fetch = async (url, options) => {
  state.fetches.push({ url, body: options?.body })
  return { ok: true, status: 200, json: async () => state.reply ?? { ok: true } }
}
globalThis.localStorage = globalThis.window.localStorage
globalThis.HTMLElement = class {}

new Function(source)()
const test = globalThis.__fixerPlugin?.__test
if (test === undefined) {
  console.error('module did not expose its test surface')
  process.exit(1)
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))
const texts = {
  'bare.on': '已关闭全部插件（{count} 个）',
  'bare.off': '插件全部运行中',
  'bare.partial': '这些插件没能关闭：{names}',
}
const t = (key, values) => {
  const template = texts[key] ?? key
  return values === undefined ? template : template.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ''))
}

function walk(node, visit) {
  if (node === null || node === undefined) return
  if (typeof node !== 'object') {
    if (typeof node === 'string' || typeof node === 'number') visit(node)
    return
  }
  visit(node)
  const children = node.props?.children
  for (const child of Array.isArray(children) ? children : [children]) walk(child, visit)
}
function textsOf(tree) {
  const out = []
  walk(tree, (node) => {
    if (typeof node === 'string') out.push(node)
  })
  return out
}
function findNode(tree, predicate) {
  let found = null
  walk(tree, (node) => {
    if (found === null && typeof node === 'object' && node !== null && predicate(node)) found = node
  })
  return found
}

// 1. a fresh browser starts outside bare mode
check('starts with the mirror off', test.bareStore.get().active === false && test.bareStore.get().count === 0)

// 2. a Host reply updates the mirror and writes the browser copy
test.syncBareFromReply({ ok: true, active: true, snapshot: { bundles: ['a', 'b'] }, disabled: ['a', 'b'] })
check('mirrors the active state', test.bareStore.get().active === true && test.bareStore.get().count === 2)
const stored = JSON.parse(state.store['icex-dsh-fixer.bare.v1'] ?? '{}')
check('writes the browser copy', stored.active === true && stored.count === 2, JSON.stringify(stored))

// 3. bare mode removes the fixer's own additions
const item = test.DeleteSessionItem({ value: 'session-1', t })
check('hides the session delete item', item === null)
const toggleCalls = state.toggles.length
test.syncNativeRailAttribute()
check('leaves the native rail visible', state.toggles.at(-1)?.[1] === false && state.toggles.length === toggleCalls + 1)

// 4. the settings page shows the switch and the recorded count
const page = test.SettingsPage({ view: 'page', t })
check('settings page names the section', textsOf(page).includes('bare.section'))
const sectionNode = findNode(page, (node) => node.type === test.BareModeSection)
check('settings page mounts the switch', sectionNode !== null)
const section = sectionNode.type(sectionNode.props)
check('the switch names bare mode', section.props.title === 'bare.title' && section.props.description === 'bare.desc')
check('the switch reports the count', textsOf(section).includes('已关闭全部插件（2 个）'), JSON.stringify(textsOf(section)))
check('summary view stays empty', test.SettingsPage({ view: 'summary', t }) === null)

function switchOf(element) {
  return findNode(element, (node) => node !== null
    && typeof node === 'object'
    && typeof node.props?.onChange === 'function'
    && Object.hasOwn(node.props, 'checked'))
}

// 5. turning bare mode off posts the action and reloads
test.syncBareFromReply({ ok: true, active: false })
state.reply = { ok: true, active: true, snapshot: { bundles: ['a', 'b', 'c'] }, disabled: ['a', 'b', 'c'] }
state.fetches.length = 0
state.reloads = 0
state.setters.length = 0
const section2 = test.BareModeSection({ t })
const switch2 = switchOf(section2)
check('the switch is a real control', switch2 !== null && typeof switch2.props.onChange === 'function')
switch2.props.onChange(!switch2.props.checked)
await flush()
check('posts the switch action', state.fetches.length === 1 && state.fetches[0].body === JSON.stringify({ action: 'on' }), JSON.stringify(state.fetches))
check('reloads after a clean change', state.reloads === 1, state.reloads)
check('mirrors the new snapshot', test.bareStore.get().active === true && test.bareStore.get().count === 3)

// 6. declining the confirmation sends nothing
state.reply = { ok: true, active: true }
state.fetches.length = 0
state.reloads = 0
state.confirms = false
test.syncBareFromReply({ ok: true, active: false })
const declinedSwitch = switchOf(test.BareModeSection({ t }))
declinedSwitch.props.onChange(!declinedSwitch.props.checked)
await flush()
check('declining the confirmation sends nothing', state.fetches.length === 0 && state.reloads === 0)
state.confirms = true

// 7. a refused layer is reported instead of reloading
state.reply = { ok: true, active: true, snapshot: { bundles: ['a'] }, disabled: [], failed: [{ name: 'a', code: 'bundle-in-use' }] }
state.fetches.length = 0
state.reloads = 0
state.setters.length = 0
test.syncBareFromReply({ ok: true, active: false })
const partialSwitch = switchOf(test.BareModeSection({ t }))
partialSwitch.props.onChange(!partialSwitch.props.checked)
await flush()
check('does not reload after a refusal', state.reloads === 0)
check('still posts the attempt', state.fetches.length === 1)
check('names the layer that stayed on', state.setters.includes('这些插件没能关闭：a'), JSON.stringify(state.setters))

// 8. the session delete item returns once bare mode is off
test.syncBareFromReply({ ok: true, active: false })
const back = test.DeleteSessionItem({ value: 'session-1', t })
check('session delete item returns', back !== null && typeof back.props?.onSelect === 'function')

console.log(failures.length === 0 ? 'FIXER BARE UI OK' : failures.length + ' FAILED')
process.exit(failures.length === 0 ? 0 : 1)

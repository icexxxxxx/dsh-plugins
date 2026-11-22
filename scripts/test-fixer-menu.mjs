#!/usr/bin/env node
/**
 * Headless test for the fixer client bundle: it loads the module with a stub
 * loader, captures the session-menu component, and drives its click handler
 * against a fake fetch and a fake workspace service.
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
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useSyncExternalStore: (_subscribe, get) => get(),
}
const menuItem = (props) => ({ type: 'MenuItemButton', props })
const icon = () => ({ type: 'Icon' })
const primitives = { MenuItemButton: menuItem, IconTrashOutlineRegular: icon }
const requireStub = (name) => {
  if (name === 'react') return react
  if (name === 'react-dom') return { createPortal: (node) => node }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return primitives
  throw new Error('unexpected require: ' + name)
}

const state = { alerts: [], reloads: 0, archiveCalls: [], fetches: [] }
globalThis.window = {
  __ModuleLoader__: {
    load: (plugin) => {
      globalThis.__fixerPlugin = plugin.factory(requireStub)
    },
  },
  confirm: () => true,
  alert: (message) => state.alerts.push(message),
  location: { reload: () => { state.reloads += 1 } },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  addEventListener: () => {},
  removeEventListener: () => {},
  matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  innerHeight: 900,
}
globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {}, style: {} }),
  head: { appendChild: () => {} },
  documentElement: { toggleAttribute: () => {}, removeAttribute: () => {}, setAttribute: () => {} },
  querySelectorAll: () => [],
  addEventListener: () => {},
  removeEventListener: () => {},
  body: { appendChild: () => {}, removeChild: () => {} },
}
globalThis.fetch = async (url, options) => {
  state.fetches.push({ url, body: options?.body })
  return { ok: true, status: 200, json: async () => state.reply ?? { ok: true } }
}
globalThis.HTMLElement = class {}

new Function(source)()
const plugin = globalThis.__fixerPlugin
if (plugin === undefined) {
  console.error('module did not register')
  process.exit(1)
}

let menuComponent = null
const workspace = {
  archiveSession: async (id) => {
    state.archiveCalls.push(id)
  },
}
const fakeCtx = {
  effect: (fn) => {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  locale: { register: () => () => {} },
  slots: {
    inject: (name, callback) => {
      const registration = callback()
      if (name === 'sidebar.workspaces.session.menu.item') menuComponent = registration.component
      return registration
    },
    register: (options, component) => ({ options, component }),
  },
  uiWorkspace: workspace,
  sessions: { list: { getSnapshot: () => ({ byId: {} }) } },
}

plugin.apply(fakeCtx)
// The plugin asks the Host for bare-mode state on load; only the menu's own
// requests matter below.
state.fetches.length = 0
check('menu component registered', typeof menuComponent === 'function')

const flush = () => new Promise((resolve) => setTimeout(resolve, 20))

const texts = {
  'menu.deleteSession': '删除会话',
  'menu.deleteLive': '这个会话正开着。先切到别的会话，再回来删除。',
  'menu.deleteFailed': '删除失败：{message}',
}
const t = (key, values) => {
  const template = texts[key] ?? key
  return values === undefined ? template : template.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? ''))
}

async function click(sessionId) {
  const props = { value: sessionId, t }
  const button = menuComponent(props)
  const onSelect = button.props.onSelect
  if (typeof onSelect !== 'function') throw new Error('menu item has no onSelect')
  onSelect()
  await flush()
  return button
}

// 1. success: delete then archive, no reload
await click('session-aaa')
check('posts the session id', state.fetches.length === 1 && state.fetches[0].body === JSON.stringify({ id: 'session-aaa' }), state.fetches[0]?.body)
check('archives the row', state.archiveCalls[0] === 'session-aaa', JSON.stringify(state.archiveCalls))
check('does not reload the page', state.reloads === 0, state.reloads)

// 2. live session: alert, no archive, no reload
state.reply = { ok: false, code: 'live', error: 'open' }
state.archiveCalls.length = 0
state.alerts.length = 0
await click('session-bbb')
check('refuses live sessions', state.alerts.length === 1 && state.alerts[0] === texts['menu.deleteLive'], state.alerts[0])
check('live session is not archived', state.archiveCalls.length === 0)
check('live session does not reload', state.reloads === 0)

// 2b. props object form (value carries the id)
state.reply = { ok: true }
state.archiveCalls.length = 0
const button = menuComponent({ value: 'session-ddd', t })
button.props.onSelect()
await flush()
check('reads the id from props.value', state.archiveCalls[0] === 'session-ddd', JSON.stringify(state.archiveCalls))

// 3. workspace service missing: falls back to a reload
state.reply = { ok: true }
state.reloads = 0
const savedWorkspace = fakeCtx.uiWorkspace
fakeCtx.uiWorkspace = undefined
await click('session-ccc')
check('falls back to reload without the workspace service', state.reloads === 1, state.reloads)
fakeCtx.uiWorkspace = savedWorkspace

console.log(failures.length === 0 ? 'FIXER MENU OK' : failures.length + ' FAILED')
process.exit(failures.length === 0 ? 0 : 1)

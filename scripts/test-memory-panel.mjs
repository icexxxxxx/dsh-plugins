#!/usr/bin/env node
/**
 * Headless test for the memory sidebar panel and its right-sidebar registration.
 * Loads the real client bundle with stub React/DOM/fetch, then renders the panel
 * against a fixed payload and drives one candidate action.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'packages/memory/client.js'), 'utf8')

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
const requireStub = (name) => {
  if (name === 'react') return react
  if (name === 'react-dom') return { createPortal: (node) => node }
  throw new Error('unexpected require: ' + name)
}

const state = { fetches: [] }
globalThis.window = { __ModuleLoader__: { load: (plugin) => { globalThis.__memoryPlugin = plugin.factory(requireStub) } } }
globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild: () => {} },
  documentElement: { toggleAttribute: () => {}, removeAttribute: () => {} },
}
globalThis.fetch = async (url, options) => {
  state.fetches.push({ url, method: options?.method ?? 'GET', body: options?.body })
  return { ok: true, status: 200, json: async () => ({ ok: true }) }
}

new Function(source)()
const plugin = globalThis.__memoryPlugin
if (plugin === undefined) { console.error('module did not register'); process.exit(1) }

let panelComponent = null
let configComponent = null
let registeredType = null
const fakeCtx = {
  effect: (fn) => { const dispose = fn(); return typeof dispose === 'function' ? dispose : () => {} },
  locale: { register: () => () => {} },
  slots: {
    inject: (name, callback) => {
      const registration = callback()
      if (name === 'plugins.bundle.config') configComponent = registration.component
      if (name === 'sidebar.right.pane.tab') panelComponent = registration.component
      return registration
    },
    register: (options, component) => ({ options, component }),
  },
  inject: (names, callback) => callback({
    sidebarRightTabs: { register: (definition) => { registeredType = definition; return () => {} } },
    slots: fakeCtx.slots,
    effect: fakeCtx.effect,
  }),
}

plugin.apply(fakeCtx)
check('page type registered', registeredType !== null && registeredType.kind === 'icex-memory-panel')
check('guide entry present', registeredType !== null && Array.isArray(registeredType.guide) && registeredType.guide.length === 1)
check('panel body registered', typeof panelComponent === 'function')
check('settings editor still registered', typeof configComponent === 'function')

const texts = {
  'panel.stats': '{entries} 条 · 摘要 {chars} 字符 · {candidates} 条候选',
  'panel.candidates': '候选',
  'panel.entries': '已存条目',
  'panel.activity': '最近活动',
  'panel.modelSays': '模型建议：{action} — {reason}',
  'panel.undecided': '模型还没判断这条。',
  'panel.promote': '转正',
  'panel.dismiss': '丢弃',
  'panel.verdictPromote': '转正',
  'panel.verdictDismiss': '丢弃',
  'panel.consolidate': '立即整理',
  'panel.refresh': '刷新',
  'panel.noCandidates': '没有待处理的候选。',
  'panel.lastConsolidated': '上次整理：{time}',
}
const t = (key, values) => {
  const template = texts[key] ?? key
  return values === undefined ? template : template.replace(/\{(\w+)\}/g, (_m, name) => String(values[name] ?? ''))
}

const payload = {
  ok: true,
  stats: { globalEntries: 1, projectEntries: 0, digestChars: 120, truncated: false, candidates: 2, lastConsolidatedAt: '2026-11-22T12:00:00.000Z' },
  global: [{ id: 'g1', kind: 'pref', text: '中文沟通，结论先行', src: 's@1', at: '2026-11-20' }],
  project: { path: null, entries: [] },
  candidates: [
    { id: 'c1', text: '以后所有回答都要先给结论', src: 's@2', at: '2026-11-22', decision: { action: 'promote', reason: '用户明确要求', at: '2026-11-22' } },
    { id: 'c2', text: '不要用表格', src: 's@3', at: '2026-11-22', decision: null },
  ],
}

const tree = panelComponent({ initial: payload, t: texts })
const flat = JSON.stringify(tree)
check('renders stats', flat.includes('1 条 · 摘要 120 字符 · 2 条候选'))
check('renders both candidates', flat.includes('以后所有回答都要先给结论') && flat.includes('不要用表格'))
check('shows the model verdict', flat.includes('模型建议：转正 — 用户明确要求'))
check('shows undecided state', flat.includes('模型还没判断这条。'))
check('renders entries and activity', flat.includes('已存条目') && flat.includes('最近活动') && flat.includes('中文沟通，结论先行'))

// click "转正" on c2
function findAction(node, action) {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findAction(item, action)
      if (found !== null) return found
    }
    return null
  }
  if (node.props?.['data-action'] === action) return node
  const children = Array.isArray(node.props?.children) ? node.props.children : []
  for (const child of children) {
    const found = findAction(child, action)
    if (found !== null) return found
  }
  return null
}

function findCandidate(node, candidateId) {
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findCandidate(item, candidateId)
      if (found !== null) return found
    }
    return null
  }
  if (node.props?.['data-candidate'] === candidateId) return node
  const children = Array.isArray(node.props?.children) ? node.props.children : []
  for (const child of children) {
    const found = findCandidate(child, candidateId)
    if (found !== null) return found
  }
  return null
}

const candidateNode = findCandidate(tree, 'c2')
const promote = candidateNode === null ? null : findAction(candidateNode, 'promote')
check('candidate row exposes a promote button', promote !== null)
if (promote !== null) {
  promote.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 20))
  const post = state.fetches.find((item) => item.method === 'POST')
  check('promote posts the candidate id', post !== undefined && post.body === JSON.stringify({ action: 'promote', id: 'c2' }), post?.body)
}

console.log(failures.length === 0 ? 'MEMORY PANEL OK' : failures.length + ' FAILED')
process.exit(failures.length === 0 ? 0 : 1)

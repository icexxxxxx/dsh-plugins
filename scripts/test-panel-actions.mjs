import { readFileSync } from 'node:fs'
const source = readFileSync('/Users/icex/codes/dsh-plugins/packages/memory/client.js', 'utf8')

let hooks = []
let hookIndex = 0
let renderFn = null
let tree = null
let rerender = () => {}

const react = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
  Fragment: Symbol(), useCallback: (f) => f, useEffect: () => {}, useLayoutEffect: () => {},
  useMemo: (f) => f(), useRef: (v) => ({ current: v }),
  useState: (init) => {
    const i = hookIndex++
    if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init
    const set = (value) => {
      hooks[i] = typeof value === 'function' ? value(hooks[i]) : value
      hookIndex = 0
      tree = renderFn()
    }
    return [hooks[i], set]
  },
  useSyncExternalStore: (_s, g) => g(),
}

const fetches = []
const payload = {
  ok: true,
  stats: { globalEntries: 1, projectEntries: 1, digestChars: 100, truncated: false, candidates: 0, lastConsolidatedAt: null },
  global: [{ id: 'g1', kind: 'pref', text: '全局条目', src: 's1', at: '2026-11-20', scope: 'global' }],
  project: { path: '/Users/icex/wtf/.dsh/memory/MEMORY.md', entries: [{ id: 'p1', kind: 'project', text: '项目条目', src: 's2', at: '2026-11-21', scope: 'project' }] },
  candidates: [],
}
globalThis.window = { __ModuleLoader__: { load: (p) => { globalThis.__p = p.factory((n) => n === 'react' ? react : { createPortal: (x) => x }) } }, confirm: () => true, alert: () => {} }
globalThis.document = { createElement: () => ({ dataset: {}, textContent: '', remove() {} }), head: { appendChild: () => {} }, documentElement: { toggleAttribute: () => {}, removeAttribute: () => {} } }
globalThis.fetch = async (url, options) => {
  fetches.push({ url, options })
  if (globalThis.__failNext === true && options?.method === 'POST') {
    return { ok: true, status: 200, json: async () => ({ ok: false, error: 'boom' }) }
  }
  return { ok: true, status: 200, json: async () => payload }
}

new Function(source)()
let panel = null
globalThis.__p.apply({
  effect: (fn) => { fn(); return () => {} },
  locale: { register: () => () => {} },
  slots: { inject: (name, cb) => { const r = cb(); if (name === 'sidebar.right.pane.tab') panel = r.component; return r }, register: (o, c) => ({ component: c }) },
  inject: (names, cb) => cb({ sidebarRightTabs: { register: () => () => {} }, slots: { inject: (name, f) => { const r = f(); if (name === 'sidebar.right.pane.tab') panel = r.component; return r }, register: (o, c) => ({ component: c }) }, effect: (fn) => { fn(); return () => {} } }),
})


const texts = {
  'panel.save': '保存', 'panel.cancel': '取消', 'panel.edit': '编辑', 'panel.delete': '删除',
  'panel.globalEntries': '全局记忆', 'panel.projectEntries': '项目记忆', 'panel.filterAll': '全部',
  'panel.status': '{entries} 条 · 摘要 {chars} 字符 · {candidates} 候选',
  'kind.pref': '偏好', 'kind.project': '项目',
}
renderFn = () => panel({ initial: payload, t: texts, sessionId: 'session-x' })
hookIndex = 0
tree = renderFn()

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name + (detail === undefined ? '' : ' (' + detail + ')'))
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}

function walk(node, pred, out = []) {
  if (node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) { node.forEach((n) => walk(n, pred, out)); return out }
  if (pred(node)) out.push(node)
  const kids = Array.isArray(node.props?.children) ? node.props.children : []
  kids.forEach((n) => walk(n, pred, out))
  return out
}
const byAction = (action) => walk(tree, (n) => n.props?.['data-action'] === action)[0]
const entryNode = (id) => walk(tree, (n) => n.props?.['data-entry'] === id)[0]
const actionIn = (id, action) => {
  const node = entryNode(id)
  return node === undefined ? undefined : walk(node, (n) => n.props?.['data-action'] === action)[0]
}
const buttonByLabel = (label) => walk(tree, (n) => n.type === 'button' && JSON.stringify(n.props?.children ?? '').includes(label))[0]
const all = () => JSON.stringify(tree)

check('shows global and project entries', all().includes('全局条目') && all().includes('项目条目'))
check('shows a project path', all().includes('MEMORY.md'))
check('uses chinese kind labels', all().includes('偏好') && all().includes('项目'))

const editBtn = actionIn('g1', 'edit')
check('edit button exists', editBtn !== undefined)
editBtn.props.onClick()
const area = walk(tree, (n) => n.type === 'textarea')[0]
check('editing opens a textarea', area !== undefined)
area.props.onChange({ target: { value: '全局条目（改）' } })

// first save fails: the editor must stay open
globalThis.__failNext = true
const saveBtn = buttonByLabel('保存')
check('save button exists', saveBtn !== undefined)
saveBtn.props.onClick()
await new Promise((r) => setTimeout(r, 20))
check('failed save keeps the editor open', walk(tree, (n) => n.type === 'textarea').length === 1)

// second save succeeds
globalThis.__failNext = false
const saveAgain = buttonByLabel('保存')
saveAgain.props.onClick()
await new Promise((r) => setTimeout(r, 20))
const updatePost = fetches.filter((f) => f.options?.method === 'POST').map((f) => JSON.parse(f.options.body)).find((b) => b.action === 'update')
check('update posts id, text and scope', updatePost !== undefined && updatePost.id === 'g1' && updatePost.text === '全局条目（改）' && updatePost.scope === 'global', JSON.stringify(updatePost))
check('successful save closes the editor', walk(tree, (n) => n.type === 'textarea').length === 0)

// delete with confirmation
const deleteBtn = actionIn('g1', 'delete')
check('delete button exists', deleteBtn !== undefined)
deleteBtn.props.onClick()
await new Promise((r) => setTimeout(r, 20))
const deletePost = fetches.filter((f) => f.options?.method === 'POST').map((f) => JSON.parse(f.options.body)).find((b) => b.action === 'delete')
check('delete posts id and scope', deletePost !== undefined && deletePost.id === 'g1' && deletePost.scope === 'global', JSON.stringify(deletePost))

console.log(failures.length === 0 ? 'PANEL ACTIONS OK' : failures.length + ' FAILED')
process.exit(failures.length === 0 ? 0 : 1)

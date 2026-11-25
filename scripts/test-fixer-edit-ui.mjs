#!/usr/bin/env node
/**
 * DOM smoke test for the bubble editor: a fake document stands in for the
 * chat column, so the pencil, the overlay keys, the request body, and the
 * branch badge are checked without a browser.
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

/** Minimal element: enough for decorate, overlay, and toast. */
class El {
  constructor(tag) {
    this.tagName = tag
    this.children = []
    this.parent = null
    this.attrs = {}
    this.style = {}
    this.listeners = {}
    this.className = ''
    this.value = ''
    this.text = ''
    this.hidden = false
    this.disabled = false
    this.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }
  }
  get classList() {
    const self = this
    return {
      add(name) {
        const set = new Set(self.className.split(' ').filter((part) => part !== ''))
        set.add(name)
        self.className = Array.from(set).join(' ')
      },
      remove(name) {
        self.className = self.className.split(' ').filter((part) => part !== '' && part !== name).join(' ')
      },
      contains(name) {
        return self.className.split(' ').includes(name)
      },
    }
  }
  set textContent(value) {
    this.text = value
    this.children = []
  }
  get textContent() {
    return this.text + this.children.map((child) => child.textContent).join('')
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value)
  }
  getAttribute(name) {
    return this.attrs[name] ?? null
  }
  appendChild(child) {
    child.parent = this
    this.children.push(child)
    return child
  }
  insertBefore(child, reference) {
    child.parent = this
    const index = reference === null ? -1 : this.children.indexOf(reference)
    if (index < 0) this.children.unshift(child)
    else this.children.splice(index, 0, child)
    return child
  }
  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parent = null
    return child
  }
  remove() {
    if (this.parent !== null) this.parent.removeChild(this)
  }
  get firstChild() {
    return this.children[0] ?? null
  }
  getBoundingClientRect() {
    return this.rect
  }
  focus() {
    document.activeElement = this
  }
  blur() {
    if (document.activeElement === this) document.activeElement = null
  }
  setSelectionRange() {}
  addEventListener(type, listener) {
    if (this.listeners[type] === undefined) this.listeners[type] = []
    this.listeners[type].push(listener)
  }
  dispatch(type, event = {}) {
    for (const listener of this.listeners[type] ?? []) listener(event)
  }
  matches(selector) {
    if (selector === ':scope > .icex-edit-wrap') return false
    if (selector.startsWith('.') && !selector.includes(' ')) return this.classList.contains(selector.slice(1))
    if (selector === '[data-message-bubble]') return this.attrs['data-message-bubble'] !== undefined
    if (selector === '.icex-edit-badge') return this.classList.contains('icex-edit-badge')
    if (selector === 'button') return this.tagName === 'button'
    if (selector === '[data-clock="start"]') return this.attrs['data-clock'] === 'start'
    if (selector === '.icex-edit-wrap') return this.classList.contains('icex-edit-wrap')
    if (selector === '.icex-edit-row') return this.classList.contains('icex-edit-row')
    if (selector === '[data-conversation-content]') return this.attrs['data-conversation-content'] !== undefined
    if (selector === '[data-conversation-scroll]') return this.attrs['data-conversation-scroll'] !== undefined
    return false
  }
  /** Only the selectors the installer uses, answered by a depth-first walk. */
  querySelector(selector) {
    const found = this.querySelectorAll(selector)
    return found.length === 0 ? null : found[0]
  }
  querySelectorAll(selector) {
    const result = []
    const userRows = selector === '[data-chat-flow-kind="user"][data-chat-turn]'
    const wrapChild = selector === ':scope > .' + 'icex-edit-wrap'
    const walk = (node, depth) => {
      for (const child of node.children) {
        const hit = userRows
          ? child.attrs['data-chat-flow-kind'] === 'user' && child.attrs['data-chat-turn'] !== undefined
          : wrapChild ? depth === 0 && child.classList.contains('icex-edit-wrap') : child.matches(selector)
        if (hit) result.push(child)
        walk(child, depth + 1)
      }
    }
    walk(this, 0)
    return result
  }
}

const documentElement = new El('html')
const head = new El('head')
const body = new El('body')
const document = {
  body,
  head,
  documentElement,
  activeElement: null,
  createElement: (tag) => new El(tag),
  createElementNS: (_ns, tag) => new El(tag),
  querySelector: (selector) => body.querySelector(selector),
  querySelectorAll: (selector) => body.querySelectorAll(selector),
  getElementById: () => null,
}

const rows = []
const scroller = new El('div')
scroller.setAttribute('data-conversation-scroll', '')
const content = new El('div')
content.setAttribute('data-conversation-content', '')
body.appendChild(content)
content.appendChild(scroller)

function addRow(turn, text) {
  const row = new El('div')
  row.setAttribute('data-chat-flow-kind', 'user')
  row.setAttribute('data-chat-turn', String(turn))
  row.rect = { left: 100, top: 100 + turn * 80, right: 700, bottom: 140 + turn * 80, width: 600, height: 40 }
  const bubble = new El('div')
  bubble.setAttribute('data-message-bubble', '')
  bubble.textContent = text
  bubble.rect = { left: 400, top: 105 + turn * 80, right: 700, bottom: 135 + turn * 80, width: 300, height: 30 }
  row.appendChild(bubble)
  const actions = new El('span')
  actions.setAttribute('data-clock', 'start')
  const copy = new El('button')
  copy.setAttribute('aria-label', '复制')
  actions.appendChild(copy)
  row.appendChild(actions)
  scroller.appendChild(row)
  rows.push({ row, bubble, actions, copy })
  return { row, bubble, actions, copy }
}
addRow(1, 'old question')

const state = { fetches: [], timers: [] }
globalThis.window = {
  innerWidth: 1000,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
  __ModuleLoader__: { load: (plugin) => { globalThis.__fixerPlugin = plugin.factory(requireStub) } },
}
globalThis.document = document
globalThis.Element = El
globalThis.HTMLElement = El
globalThis.__ICEX_FIXER_TEST__ = true
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0)
globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
globalThis.fetch = async (url, options) => {
  state.fetches.push({ url: String(url), options })
  const method = options?.method ?? 'GET'
  if (String(url).startsWith('/api/icex-fixer/branches')) {
    return { ok: true, status: 200, json: async () => ({ ok: true, items: state.markers ?? [] }) }
  }
  if (method === 'GET') {
    return { ok: true, status: 200, json: async () => ({ ok: true, text: state.original ?? 'old question', atSeq: 0 }) }
  }
  return state.postReply ?? { ok: true, status: 200, json: async () => ({ ok: true, sessionId: 'child-1', turn: 1 }) }
}

const requireStub = (name) => {
  if (name === 'react') {
    return {
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
  }
  if (name === 'react-dom') return { createPortal: (node) => node }
  if (name === '@deepseek-ai/dsh-client-ui-primitives') return { MenuItemButton: (props) => ({ type: 'MenuItemButton', props }), IconTrashOutlineRegular: () => ({ type: 'Icon' }) }
  throw new Error('unexpected require: ' + name)
}

new Function(source)()
const plugin = globalThis.__fixerPlugin
const t = (key, values) => {
  const text = {
    'edit.title': '编辑并重发',
    'edit.branchBadge': '已分支',
    'edit.openBranch': '打开分支',
    'edit.cancel': '取消',
    'edit.send': '重发',
    'edit.sending': '正在创建分支…',
    'edit.hint': 'Enter 重发 · Shift+Enter 换行 · Esc 取消',
    'edit.failed': '重发失败：{message}',
    'edit.offline': '无法连接宿主',
    'edit.toast': '已从该条消息创建分支',
    'edit.back': '返回原会话',
  }[key] ?? key
  return values === undefined ? text : text.replace(/\{(\w+)\}/g, (_match, name) => String(values[name] ?? ''))
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 30))

const dispose = plugin.__test.installEditBubbles('session-a', t)
await tick()

const wrap = rows[0].row.querySelector('.icex-edit-wrap')
check('decorates the user row', wrap !== null && wrap.classList.contains('icex-edit-wrap'))
const pencil = wrap?.children.find((child) => child.classList.contains('icex-edit-pencil'))
check('adds a pencil', pencil !== undefined)
check('pencil joins the native action row', wrap?.parent === rows[0].actions)
check('pencil follows the copy button in that row', rows[0].actions.children.indexOf(wrap) === rows[0].actions.children.indexOf(rows[0].copy) + 1)
check('pencil uses the native 28px/15px action sizing', source.includes('width: calc(28px + var(--dsh-content-font-delta, 0px)); height: calc(28px + var(--dsh-content-font-delta, 0px)); padding: 6px;')
  && source.includes('.icex-edit-pencil svg { width: calc(15px'))
const initialFetches = state.fetches.length
check('loads the markers once', initialFetches === 1 && state.fetches[0].url === '/api/icex-fixer/branches?sessionId=session-a', JSON.stringify(state.fetches.map((item) => item.url)))

pencil.dispatch('click')
await tick()
check('prepare reads the turn', state.fetches[1]?.url === '/api/icex-fixer/branch?sessionId=session-a&turn=1', state.fetches[1]?.url)
const overlay = body.children.find((child) => child.classList.contains('icex-edit-overlay'))
check('opens an overlay in the body', overlay !== undefined)
const textarea = overlay?.children.find((child) => child.classList.contains('icex-edit-textarea'))
check('seeds the editor with the original text', textarea?.value === 'old question', textarea?.value)
check('editor spans the message column', overlay?.style.width === '600px', overlay?.style.width)
check('editor starts at the column left', overlay?.style.left === '100px', overlay?.style.left)
check('hides the original bubble', rows[0].bubble.style.visibility === 'hidden')

// Shift+Enter keeps editing, Enter sends
const before = state.fetches.length
textarea.dispatch('keydown', { key: 'Enter', shiftKey: true, preventDefault: () => {} })
await tick()
check('Shift+Enter does not send', state.fetches.length === before)
textarea.value = 'edited question'
textarea.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault: () => {} })
await tick()
const post = state.fetches.find((item) => item.options?.method === 'POST')
check('Enter sends the edit', post !== undefined)
check('posts session, turn, and text', post?.options.body === JSON.stringify({ sessionId: 'session-a', turn: 1, text: 'edited question' }), post?.options.body)
check('closes the overlay after success', body.children.every((child) => !child.classList.contains('icex-edit-overlay')))
check('restores the bubble visibility', rows[0].bubble.style.visibility !== 'hidden')
const badge = rows[0].row.querySelector('.icex-edit-badge')
check('shows the branch badge', badge !== null && badge.textContent === '已分支')
const toast = body.children.find((child) => child.classList.contains('icex-edit-toast'))
check('shows the branch toast', toast !== undefined && toast.textContent.includes('已从该条消息创建分支'))

// unchanged text closes without a request; a failed POST keeps the editor
const disposeThird = plugin.__test.installEditBubbles('session-a', t)
await tick()
let pencilThird = body.querySelector('.icex-edit-pencil')
pencilThird.dispatch('click')
await tick()
let overlayThird = body.children.find((child) => child.classList.contains('icex-edit-overlay'))
const textareaThird = overlayThird?.children.find((child) => child.classList.contains('icex-edit-textarea'))
const postsBefore = state.fetches.filter((item) => item.options?.method === 'POST').length
textareaThird.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault: () => {} })
await tick()
check('unchanged text closes without posting', state.fetches.filter((item) => item.options?.method === 'POST').length === postsBefore
  && body.children.every((child) => !child.classList.contains('icex-edit-overlay')))

pencilThird.dispatch('click')
await tick()
overlayThird = body.children.find((child) => child.classList.contains('icex-edit-overlay'))
const retryArea = overlayThird?.children.find((child) => child.classList.contains('icex-edit-textarea'))
retryArea.value = 'will fail'
state.postReply = { ok: false, status: 500, json: async () => ({ ok: false, code: 'prompt-failed', error: 'boom' }) }
retryArea.dispatch('keydown', { key: 'Enter', shiftKey: false, preventDefault: () => {} })
await tick()
const keptOverlay = body.children.find((child) => child.classList.contains('icex-edit-overlay'))
const errorLine = keptOverlay?.children.find((child) => child.classList.contains('icex-edit-error'))
check('failed send keeps the editor', keptOverlay !== undefined)
check('failed send shows the reason', errorLine !== undefined && errorLine.textContent.includes('boom'), errorLine?.textContent)
retryArea.dispatch('keydown', { key: 'Escape', preventDefault: () => {} })
await tick()
check('Escape closes the editor', body.children.every((child) => !child.classList.contains('icex-edit-overlay')))
disposeThird()

// a second install sees the persisted marker
const disposeSecond = plugin.__test.installEditBubbles('session-a', t)
state.markers = [{ turn: 1, childId: 'child-1', atSeq: 0 }]
await tick()
const badges = body.querySelectorAll('.icex-edit-badge')
check('restores the badge from the marker route', badges.length >= 1)
disposeSecond()
dispose()
await tick()
check('cleanup removes its decoration', body.querySelectorAll('.icex-edit-wrap').length === 0)

console.log(failures.length === 0 ? 'EDIT UI OK' : failures.length + ' FAILED')
process.exit(failures.length === 0 ? 0 : 1)

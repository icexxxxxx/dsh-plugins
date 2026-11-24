#!/usr/bin/env node
/**
 * Headless test for the fixer's edit-and-resend routes: the edited turn forks
 * at the event before its user message, the child receives the rewritten text
 * plus the original images, and a marker remembers the branch. No DSH runtime.
 */
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = mkdtempSync(join(tmpdir(), 'dsh-fixer-branch-'))
process.env.DSH_HOME = home
process.env.DSH_PROFILE = 'test'
const { apply } = await import('../packages/fixer/index.js')
const t = apply.__test

const failures = []
const check = (name, ok, detail) => {
  if (!ok) failures.push(name + (detail === undefined ? '' : ' (' + detail + ')'))
  console.log((ok ? 'PASS ' : 'FAIL ') + name)
}

/** One turn: start at seq 2, user message at seq 3 with text and an image. */
const events = [
  { type: 'session/created', seq: 0, data: {} },
  { type: 'agent/message', seq: 1, data: {} },
  { type: 'turn/start', seq: 2, data: { turn: 1 } },
  {
    type: 'user/message',
    seq: 3,
    surfaceOp: 'append',
    data: {
      source: { kind: 'user' },
      content: [
        { type: 'text', text: 'old question' },
        { type: 'image', attachment: { id: 'image-1' } },
      ],
    },
  },
  { type: 'turn/end', seq: 4, data: { turn: 1 } },
]

// 1. the prompt of one turn, its cut, and its text
const prompt = t.readTurnPrompt(events, 1)
check('finds the prompt of a turn', prompt.turn === 1 && prompt.seq === 3, JSON.stringify(prompt))
check('cuts before the user message', prompt.atSeq === 1)
check('keeps the original text', prompt.text === 'old question')
check('keeps the image part', prompt.content.some((part) => part.type === 'image'))

// 2. refusals
check('missing turn refuses', t.readTurnPrompt(events, 9).code === 'turn-missing')
const firstTurn = [
  { type: 'turn/start', seq: 0, data: { turn: 1 } },
  { type: 'user/message', seq: 1, surfaceOp: 'append', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'x' }] } },
]
check('turn with nothing before it refuses', t.readTurnPrompt(firstTurn, 1).code === 'fork-unavailable')

// 3. edited content replaces text and keeps other parts
const edited = t.editedContent(prompt.content, 'new question')
check('replaces the text exactly once', edited.filter((part) => part.type === 'text').length === 1
  && edited.find((part) => part.type === 'text').text === 'new question')
check('keeps the image in the edited content', edited.some((part) => part.type === 'image'))
const textOnly = t.editedContent([{ type: 'image', attachment: { id: 'only' } }], 'added')
check('adds text before an attachment-only message', textOnly[0].type === 'text' && textOnly[1].type === 'image')

/** A fake Host context: history, controller, and captured prompt calls. */
function makeCtx(options = {}) {
  const calls = { fork: [], prompt: [] }
  const ctx = {
    get: (name) => {
      if (name === 'sessionQuery') {
        return {
          readSession: async (id) => {
            if (options.missing === true) {
              const error = new Error('session not found')
              error.code = 'SESSION_QUERY_SESSION_NOT_FOUND'
              throw error
            }
            if (id !== 'session-a') throw new Error('unexpected session ' + id)
            return { session: { id }, events }
          },
        }
      }
      if (name === 'sessionController') {
        return {
          fork: async (request) => {
            calls.fork.push(request)
            if (options.forkThrows === true) throw new Error('fork failed')
            return { sessionId: 'session-child' }
          },
          prompt: async (request) => {
            calls.prompt.push(request)
            if (options.promptThrows === true) throw new Error('prompt failed')
            return { accepted: true }
          },
        }
      }
      return undefined
    },
  }
  return { ctx, calls }
}

const getRequest = (sessionId, turn) => new Request(
  'http://127.0.0.1/api/icex-fixer/branch?sessionId=' + encodeURIComponent(sessionId) + '&turn=' + String(turn),
  { method: 'GET' },
)
const postRequest = (body, method = 'POST') => new Request('http://127.0.0.1/api/icex-fixer/branch', {
  method,
  headers: { 'content-type': 'application/json' },
  body: method === 'GET' ? undefined : JSON.stringify(body),
})

// 4. prepare returns the original text and the cut
let harness = makeCtx()
let response = await t.prepareBranch(getRequest('session-a', 1), harness.ctx)
let body = await response.json()
check('prepare returns the text', response.status === 200 && body.ok === true && body.text === 'old question', JSON.stringify(body))
check('prepare returns the cut', body.atSeq === 1)
check('prepare rejects a bad session id', (await t.prepareBranch(getRequest('../etc', 1), harness.ctx)).status === 400)
check('prepare rejects a bad turn', (await t.prepareBranch(getRequest('session-a', -1), harness.ctx)).status === 400)
check('prepare reports a missing session', (await t.prepareBranch(getRequest('session-a', 1), makeCtx({ missing: true }).ctx)).status === 404)

// 5. create forks before the message and prompts the child with the edit
harness = makeCtx()
response = await t.createBranch(postRequest({ sessionId: 'session-a', turn: 1, text: 'edited question' }), harness.ctx)
body = await response.json()
check('create answers with the child id', response.status === 200 && body.ok === true && body.sessionId === 'session-child', JSON.stringify(body))
check('create forks at the cut', harness.calls.fork.length === 1 && harness.calls.fork[0].atSeq === 1)
check('create prompts the child, not the source', harness.calls.prompt.length === 1 && harness.calls.prompt[0].sessionId === 'session-child')
check('create sends the edited text', harness.calls.prompt[0].content.find((part) => part.type === 'text').text === 'edited question')
check('create keeps the image', harness.calls.prompt[0].content.some((part) => part.type === 'image'))
check('create records a request id', typeof harness.calls.prompt[0].requestId === 'string' && harness.calls.prompt[0].requestId !== '')
check('create stores a branch marker', t.branchItems('session-a').some((item) => item.turn === 1 && item.childId === 'session-child'))
check('marker file exists', existsSync(t.BRANCH_STATE_FILE))
check('marker file is JSON', (() => {
  try {
    return JSON.parse(readFileSync(t.BRANCH_STATE_FILE, 'utf8')).version === 1
  } catch (error) {
    return false
  }
})())

// 6. refusals and a prompt failure that leaves the child without a marker
check('empty text refuses', (await t.createBranch(postRequest({ sessionId: 'session-a', turn: 1, text: '  ' }), harness.ctx)).status === 400)
check('missing turn refuses', (await t.createBranch(postRequest({ sessionId: 'session-a', turn: 9, text: 'x' }), harness.ctx)).status === 409)
const failed = await t.createBranch(postRequest({ sessionId: 'session-a', turn: 1, text: 'again' }), makeCtx({ promptThrows: true }).ctx)
const failedBody = await failed.json()
check('prompt failure reports the child', failed.status === 500 && failedBody.code === 'prompt-failed' && failedBody.sessionId === 'session-child', JSON.stringify(failedBody))
check('prompt failure leaves no marker for that run', t.branchItems('session-a').length === 1)

// 7. markers route returns what the store holds
response = await t.handleBranchMarkers(new Request('http://127.0.0.1/api/icex-fixer/branches?sessionId=session-a'))
body = await response.json()
check('markers route returns the branch', response.status === 200 && body.items.length === 1 && body.items[0].childId === 'session-child')
check('markers route rejects a bad id', (await t.handleBranchMarkers(new Request('http://127.0.0.1/api/icex-fixer/branches?sessionId='))).status === 400)

if (failures.length > 0) {
  console.error('FAILED ' + failures.length + ': ' + failures.join('; '))
  process.exit(1)
}
console.log('BRANCH TEST OK')

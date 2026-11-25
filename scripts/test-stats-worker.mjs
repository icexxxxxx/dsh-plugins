/**
 * Smoke checks for the Cloudflare usage collector: request validation, the D1
 * upsert shape, token auth and the aggregate response. Uses a fake D1 binding,
 * so it runs without wrangler or a network.
 */
import assert from 'node:assert/strict'
import worker from '../cloudflare/worker.js'

let passed = 0
async function check(name, run) {
  await run()
  passed += 1
  console.log('PASS ' + name)
}

function fakeDb() {
  const calls = { run: [], all: [], first: [] }
  return {
    calls,
    prepare(sql) {
      return {
        bind(...values) {
          calls.run.push({ sql, values })
          return this
        },
        async run() {
          return { success: true }
        },
        async first() {
          calls.first.push({ sql })
          return { installs: 2, users: 1 }
        },
        async all() {
          calls.all.push({ sql })
          return {
            results: [
              {
                payload: JSON.stringify({
                  generatedAt: '2026-01-01T00:00:00.000Z',
                  appVersion: '0.2.2-rc.5',
                  platform: 'darwin',
                  nickname: 'icex',
                  plugins: [{ name: 'icex-dsh-fixer', version: '0.3.12', enabled: true, counts: { branch: 2 } }],
                }),
              },
            ],
          }
        },
      }
    },
  }
}

const good = {
  schema: 1,
  installId: '11111111-1111-1111-1111-111111111111',
  generatedAt: '2026-01-01T00:00:00.000Z',
  appVersion: '0.2.2-rc.5',
  platform: 'darwin',
  nickname: 'icex',
  plugins: [{ name: 'icex-dsh-fixer', version: '0.3.12', enabled: true, counts: { branch: 2, bad: 1 } }],
  manager: { pageOpen: 3 },
}

await check('report upserts one row per install and day', async () => {
  const env = { DB: fakeDb(), ADMIN_TOKEN: 'secret' }
  const response = await worker.fetch(
    new Request('https://stats.example/v1/report', { method: 'POST', body: JSON.stringify(good) }),
    env,
  )
  assert.equal(response.status, 200)
  const insert = env.DB.calls.run[0]
  assert.match(insert.sql, /INSERT INTO reports/)
  assert.equal(insert.values[0], good.installId)
  assert.equal(insert.values[1], '2026-01-01')
  const payload = JSON.parse(insert.values[5])
  assert.equal(payload.nickname, 'icex')
  assert.deepEqual(payload.plugins[0].counts, { branch: 2, bad: 1 })
})

await check('report rejects invalid payloads', async () => {
  const env = { DB: fakeDb(), ADMIN_TOKEN: 'secret' }
  for (const body of ['nope', JSON.stringify({ schema: 2 }), JSON.stringify({ ...good, installId: 'x' })]) {
    const response = await worker.fetch(
      new Request('https://stats.example/v1/report', { method: 'POST', body }),
      env,
    )
    assert.equal(response.status, 400)
  }
})

await check('stats require the admin token', async () => {
  const env = { DB: fakeDb(), ADMIN_TOKEN: 'secret' }
  const denied = await worker.fetch(new Request('https://stats.example/v1/stats'), env)
  assert.equal(denied.status, 401)
  const wrong = await worker.fetch(new Request('https://stats.example/v1/stats?token=nope'), env)
  assert.equal(wrong.status, 401)
})

await check('stats aggregate installs, versions, platforms and plugin counts', async () => {
  const env = { DB: fakeDb(), ADMIN_TOKEN: 'secret' }
  const response = await worker.fetch(new Request('https://stats.example/v1/stats?token=secret'), env)
  assert.equal(response.status, 200)
  const data = await response.json()
  assert.equal(data.installs, 2)
  assert.equal(data.activeToday, 1)
  assert.deepEqual(data.versions, [{ version: '0.2.2-rc.5', installs: 1 }])
  assert.deepEqual(data.platforms, [{ platform: 'darwin', installs: 1 }])
  assert.equal(data.plugins[0].counts.branch, 2)
  assert.deepEqual(data.nicknames, ['icex'])
})

await check('dashboard is html and never echoes the token', async () => {
  const env = { DB: fakeDb(), ADMIN_TOKEN: 'secret' }
  const response = await worker.fetch(new Request('https://stats.example/?token=secret'), env)
  assert.equal(response.status, 200)
  const html = await response.text()
  assert.match(html, /icex usage/)
  assert.ok(!html.includes('secret'))
})

console.log('STATS WORKER TEST OK (' + passed + ' checks)')

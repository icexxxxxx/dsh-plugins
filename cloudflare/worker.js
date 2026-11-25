/**
 * icex plugin usage collector — Cloudflare Worker + D1.
 *
 * POST /v1/report  receives one anonymous snapshot from icex-dsh-plugin-center.
 * GET  /v1/stats   returns aggregates; requires ?token=ADMIN_TOKEN or x-admin-token.
 * GET  /           a small dashboard that asks for the admin token locally.
 *
 * Privacy contract: the snapshot contains a random install id, versions,
 * platform, enabled flags and feature counters. It never contains prompts,
 * file paths, session text or a device name. Reports are upserted once per
 * install id per UTC day, so retries are idempotent.
 */

const MAX_BODY = 64 * 1024
const MAX_PLUGINS = 30
const MAX_COUNT = 1_000_000_000
const MAX_ROWS = 5000

function json(body, status = 200, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extra,
    },
  })
}

function cors(response) {
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'POST, OPTIONS')
  headers.set('access-control-allow-headers', 'content-type')
  return new Response(response.body, { status: response.status, headers })
}

function cleanName(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(value) ? value : null
}

function cleanVersion(value) {
  return typeof value === 'string' && /^[0-9A-Za-z.+_-]{1,40}$/.test(value) ? value : null
}

function cleanCount(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number < 0) return 0
  return Math.min(MAX_COUNT, Math.floor(number))
}

function sanitise(body) {
  if (body === null || typeof body !== 'object' || body.schema !== 1) return null
  const installId = typeof body.installId === 'string' ? body.installId : ''
  if (!/^[0-9a-f-]{8,64}$/i.test(installId)) return null
  const generatedAt = typeof body.generatedAt === 'string' ? body.generatedAt : new Date().toISOString()
  const day = /^\d{4}-\d{2}-\d{2}$/.test(generatedAt.slice(0, 10)) ? generatedAt.slice(0, 10) : new Date().toISOString().slice(0, 10)
  const plugins = []
  if (Array.isArray(body.plugins)) {
    for (const item of body.plugins.slice(0, MAX_PLUGINS)) {
      const name = cleanName(item?.name)
      if (name === null) continue
      const counts = {}
      if (item.counts !== null && typeof item.counts === 'object') {
        for (const [event, value] of Object.entries(item.counts).slice(0, 40)) {
          if (/^[a-z][A-Za-z0-9]{0,40}$/.test(event)) counts[event] = cleanCount(value)
        }
      }
      plugins.push({ name, version: cleanVersion(item.version), enabled: item.enabled === true, counts })
    }
  }
  const manager = {}
  if (body.manager !== null && typeof body.manager === 'object') {
    for (const [event, value] of Object.entries(body.manager).slice(0, 20)) {
      if (/^[a-z][A-Za-z0-9]{0,40}$/.test(event)) manager[event] = cleanCount(value)
    }
  }
  return {
    schema: 1,
    installId,
    generatedAt,
    day,
    appVersion: cleanVersion(body.appVersion),
    platform: typeof body.platform === 'string' ? body.platform.slice(0, 40) : null,
    arch: typeof body.arch === 'string' ? body.arch.slice(0, 40) : null,
    locale: typeof body.locale === 'string' ? body.locale.slice(0, 40) : null,
    nickname: typeof body.nickname === 'string' ? body.nickname.slice(0, 40) : '',
    plugins,
    manager,
  }
}

async function report(request, env) {
  if (env.DB === undefined) return json({ ok: false, error: 'database-not-configured' }, 500)
  const length = Number(request.headers.get('content-length') ?? '0')
  if (Number.isFinite(length) && length > MAX_BODY) return cors(json({ ok: false, error: 'body-too-large' }, 413))
  const text = await request.text()
  if (text.length > MAX_BODY) return cors(json({ ok: false, error: 'body-too-large' }, 413))
  let body = null
  try {
    body = JSON.parse(text)
  } catch (error) {
    return cors(json({ ok: false, error: 'invalid-json' }, 400))
  }
  const payload = sanitise(body)
  if (payload === null) return cors(json({ ok: false, error: 'invalid-payload' }, 400))
  const receivedAt = new Date().toISOString()
  await env.DB.prepare(
    `INSERT INTO reports (install_id, day, received_at, app_version, platform, payload)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(install_id, day) DO UPDATE SET
       received_at = excluded.received_at,
       app_version = excluded.app_version,
       platform = excluded.platform,
       payload = excluded.payload`,
  )
    .bind(
      payload.installId,
      payload.day,
      receivedAt,
      payload.appVersion,
      payload.platform,
      JSON.stringify(payload),
    )
    .run()
  return cors(json({ ok: true }))
}

function authorised(url, request, env) {
  const expected = typeof env.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : ''
  if (expected === '') return false
  const supplied = url.searchParams.get('token') ?? request.headers.get('x-admin-token') ?? ''
  if (supplied.length !== expected.length) return false
  let diff = 0
  for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ supplied.charCodeAt(index)
  return diff === 0
}

async function aggregate(env) {
  const total = await env.DB.prepare('SELECT COUNT(DISTINCT install_id) AS installs FROM reports').first()
  const today = new Date().toISOString().slice(0, 10)
  const active = await env.DB.prepare('SELECT COUNT(DISTINCT install_id) AS users FROM reports WHERE day = ?').bind(today).first()
  const daily = await env.DB.prepare('SELECT day, COUNT(DISTINCT install_id) AS users FROM reports GROUP BY day ORDER BY day DESC LIMIT 30').all()
  const rows = await env.DB.prepare('SELECT payload FROM reports ORDER BY received_at DESC LIMIT ?').bind(MAX_ROWS).all()
  const versions = new Map()
  const platforms = new Map()
  const plugins = new Map()
  const nicknames = []
  let latest = null
  for (const row of rows.results ?? []) {
    let payload = null
    try {
      payload = JSON.parse(row.payload)
    } catch (error) {
      continue
    }
    if (latest === null || String(payload.generatedAt ?? '') > String(latest)) latest = payload.generatedAt ?? null
    if (payload.appVersion) versions.set(payload.appVersion, (versions.get(payload.appVersion) ?? 0) + 1)
    if (payload.platform) platforms.set(payload.platform, (platforms.get(payload.platform) ?? 0) + 1)
    if (typeof payload.nickname === 'string' && payload.nickname !== '') nicknames.push(payload.nickname)
    for (const plugin of payload.plugins ?? []) {
      const entry = plugins.get(plugin.name) ?? { enabled: 0, counts: {} }
      if (plugin.enabled === true) entry.enabled += 1
      for (const [event, value] of Object.entries(plugin.counts ?? {})) entry.counts[event] = (entry.counts[event] ?? 0) + value
      plugins.set(plugin.name, entry)
    }
  }
  return {
    ok: true,
    installs: total?.installs ?? 0,
    activeToday: active?.users ?? 0,
    latestReport: latest,
    daily: (daily.results ?? []).reverse(),
    versions: [...versions].map(([version, installs]) => ({ version, installs })).sort((a, b) => b.installs - a.installs),
    platforms: [...platforms].map(([platform, installs]) => ({ platform, installs })),
    plugins: [...plugins].map(([name, entry]) => ({ name, ...entry })).sort((a, b) => a.name.localeCompare(b.name)),
    nicknames: [...new Set(nicknames)].slice(0, 200),
  }
}

async function stats(url, request, env) {
  if (!authorised(url, request, env)) return json({ ok: false, error: 'unauthorised' }, 401)
  return json(await aggregate(env))
}

function page() {
  return `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>icex usage</title>
<style>
  :root { color-scheme: dark; --bg:#0d0d0f; --card:#17181b; --line:#2a2b30; --text:#f2f3f5; --muted:#8b8d93; --accent:#5b8cff; }
  * { box-sizing:border-box; }
  body { margin:0; padding:32px; background:var(--bg); color:var(--text); font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
  main { max-width:900px; margin:0 auto; }
  h1 { font-size:20px; margin:0 0 4px; } p { color:var(--muted); margin:0 0 20px; }
  .bar { display:flex; gap:8px; margin-bottom:20px; }
  input,button { height:32px; border:1px solid var(--line); border-radius:8px; background:var(--card); color:var(--text); padding:0 10px; font:inherit; }
  button { cursor:pointer; background:var(--accent); border-color:transparent; color:#fff; }
  .grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); gap:12px; margin-bottom:20px; }
  .stat,.card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:14px; }
  .stat span { color:var(--muted); font-size:11px; } .stat strong { display:block; font-size:24px; margin-top:2px; }
  .card { margin-bottom:12px; } h2 { font-size:13px; margin:0 0 8px; }
  table { width:100%; border-collapse:collapse; } td,th { text-align:left; padding:6px 4px; border-top:1px solid var(--line); font-weight:400; }
  th { color:var(--muted); font-size:11px; } code { color:#c9d4ff; }
  .muted { color:var(--muted); } .row { display:flex; justify-content:space-between; gap:12px; }
  .err { color:#ff6b6b; }
</style>
<main>
  <h1>icex usage</h1>
  <p>聚合数据来自选择加入匿名统计的 icex 插件用户。token 只保存在本页内存里。</p>
  <div class="bar"><input id="t" type="password" placeholder="ADMIN_TOKEN" style="flex:1"><button id="go">加载</button></div>
  <div id="err" class="err"></div>
  <div id="out"></div>
</main>
<script>
const out = document.getElementById('out')
const err = document.getElementById('err')
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])) }
function table(rows, head, cells) {
  if (rows.length === 0) return '<p class="muted">暂无数据</p>'
  return '<table><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map((row) => '<tr>' + cells.map((c) => '<td>' + c(row) + '</td>').join('') + '</tr>').join('') + '</tbody></table>'
}
async function load() {
  err.textContent = ''
  const token = document.getElementById('t').value.trim()
  if (token === '') { err.textContent = '请输入 token'; return }
  out.innerHTML = '<p class="muted">加载中…</p>'
  try {
    const response = await fetch('/v1/stats?token=' + encodeURIComponent(token))
    const data = await response.json()
    if (!response.ok || data.ok !== true) throw new Error(data.error || ('HTTP ' + response.status))
    out.innerHTML =
      '<div class="grid">' +
        '<div class="stat"><span>独立安装</span><strong>' + esc(data.installs) + '</strong></div>' +
        '<div class="stat"><span>今日活跃</span><strong>' + esc(data.activeToday) + '</strong></div>' +
        '<div class="stat"><span>最近上报</span><strong>' + esc(String(data.latestReport || '—').slice(0, 10)) + '</strong></div>' +
      '</div>' +
      '<div class="card"><h2>每日活跃</h2>' + table(data.daily, ['日期', '用户'], [(r) => esc(r.day), (r) => esc(r.users)]) + '</div>' +
      '<div class="card"><h2>版本</h2>' + table(data.versions, ['版本', '安装'], [(r) => '<code>' + esc(r.version) + '</code>', (r) => esc(r.installs)]) + '</div>' +
      '<div class="card"><h2>平台</h2>' + table(data.platforms, ['平台', '安装'], [(r) => esc(r.platform), (r) => esc(r.installs)]) + '</div>' +
      '<div class="card"><h2>插件功能</h2>' + table(data.plugins, ['插件', '启用', '计数'], [(r) => esc(r.name), (r) => esc(r.enabled), (r) => esc(Object.entries(r.counts).map(([k,v]) => k + ' ' + v).join(' · '))]) + '</div>' +
      (data.nicknames.length ? '<div class="card"><h2>署名（可选）</h2><p class="muted">' + esc(data.nicknames.join('、')) + '</p></div>' : '')
  } catch (e) {
    err.textContent = e.message
    out.innerHTML = ''
  }
}
document.getElementById('go').addEventListener('click', load)
document.getElementById('t').addEventListener('keydown', (e) => { if (e.key === 'Enter') load() })
</script>
</html>`
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    try {
      if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
      if (url.pathname === '/v1/report' && request.method === 'POST') return await report(request, env)
      if (url.pathname === '/v1/stats' && request.method === 'GET') return await stats(url, request, env)
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(page(), { headers: { 'content-type': 'text/html; charset=utf-8' } })
      }
      return json({ ok: false, error: 'not-found' }, 404)
    } catch (error) {
      return json({ ok: false, error: 'worker-error', message: String(error?.message ?? error) }, 500)
    }
  },
}

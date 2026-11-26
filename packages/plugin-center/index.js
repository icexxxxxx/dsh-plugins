/**
 * Host half of icex-dsh-plugin-center: serves the plugin-center page from the
 * profile's PluginManager and runs optional automatic updates.
 *
 * The page itself lives in client.js. Every operation goes through the same
 * PluginManager service the official Plugins page uses, so enablement,
 * removal checks, install recovery and restart reporting keep their shipped
 * behaviour instead of being re-implemented here.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** This bundle never removes or disables itself from its own page. */
const SELF = 'icex-dsh-plugin-center'
const DEFAULT_ENDPOINT = 'https://icex-plugin-stats.icex-tools.workers.dev/v1/report'

/** Plugins the page offers before they are installed. Titles come from the client dictionaries. */
const CATALOG = [
  {
    name: 'icex-dsh-fixer',
    title: 'Fixer',
    summary: '编辑已发消息并分支重发；左侧锚点跳转输入，双击右 Option 唤起窗口。',
  },
  {
    name: 'icex-dsh-memory',
    title: 'Memory',
    summary: '跨会话记忆：自动发掘候选、确认后注入新会话。',
  },
  {
    name: SELF,
    title: 'Plugin Center',
    summary: '一键安装、更新、启停 icex 插件，支持自动更新与匿名使用统计。',
  },
]

const DSH_HOME = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
const CONFIG_FILE = join(DSH_HOME, 'plugin-center', 'config.json')
const STATS_FILE = join(DSH_HOME, 'plugin-center', 'stats.json')
const HOST_LOG = join(DSH_HOME, 'plugin-center', 'host.log')
const FIRST_DELAY_MS = 20_000
const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000
const REPORT_TIMEOUT_MS = 30_000
const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 168

/** Append a boot/diagnostic line; never throws, and rotates past 128 KB. */
function logHost(line) {
  try {
    mkdirSync(dirname(HOST_LOG), { recursive: true })
    if (existsSync(HOST_LOG) && statSync(HOST_LOG).size > 128 * 1024) writeFileSync(HOST_LOG, '')
    appendFileSync(HOST_LOG, `${new Date().toISOString()} ${line}\n`)
  } catch (error) {
    // Diagnostics must never break the plugin.
  }
}

/** One JSON response with no-store caching. */
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** True for the packages this page manages. */
function own(name) {
  return typeof name === 'string' && name.startsWith('icex-dsh-')
}

/** Default configuration for a profile that never opened the page. */
function defaultConfig() {
  return {
    version: 1,
    autoUpdate: { enabled: false, intervalHours: 6, packages: {} },
    telemetry: { enabled: true, endpoint: DEFAULT_ENDPOINT, nickname: '', proxy: '', decidedAt: null },
    lastCheck: null,
  }
}

/** Normalise anything read from disk, so a torn or hand-edited file cannot break the page. */
function normaliseConfig(raw) {
  const config = defaultConfig()
  if (raw === null || typeof raw !== 'object') return config
  const auto = raw.autoUpdate
  if (auto !== null && typeof auto === 'object') {
    config.autoUpdate.enabled = auto.enabled === true
    const hours = Number(auto.intervalHours)
    if (Number.isFinite(hours)) {
      config.autoUpdate.intervalHours = Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, Math.round(hours)))
    }
    if (auto.packages !== null && typeof auto.packages === 'object') {
      for (const [name, value] of Object.entries(auto.packages)) {
        if (own(name) && value === true) config.autoUpdate.packages[name] = true
      }
    }
  }
  const telemetry = raw.telemetry
  if (telemetry !== null && typeof telemetry === 'object') {
    config.telemetry.enabled = telemetry.enabled === true
    config.telemetry.endpoint = cleanEndpoint(telemetry.endpoint)
    config.telemetry.nickname = String(telemetry.nickname ?? '').trim().slice(0, 40)
    config.telemetry.proxy = cleanEndpoint(telemetry.proxy)
    config.telemetry.decidedAt = typeof telemetry.decidedAt === 'string' ? telemetry.decidedAt : null
  }
  config.lastCheck = raw.lastCheck ?? null
  return config
}

/** Only accept an absolute http(s) endpoint; anything else is treated as unset. */
function cleanEndpoint(value) {
  const text = String(value ?? '').trim().slice(0, 500)
  if (text === '') return ''
  try {
    const url = new URL(text)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : ''
  } catch (error) {
    return ''
  }
}

/** Read the config, or the defaults when the file is absent or unreadable. */
function readConfig() {
  if (!existsSync(CONFIG_FILE)) return defaultConfig()
  try {
    return normaliseConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')))
  } catch (error) {
    return defaultConfig()
  }
}

/** Replace the config atomically; the directory is created on first write. */
function writeConfig(next) {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true })
  const temporary = CONFIG_FILE + '.' + String(process.pid) + '.tmp'
  writeFileSync(temporary, JSON.stringify(next, null, 2) + '\n')
  renameSync(temporary, CONFIG_FILE)
}

/** Local usage counters. They never leave the machine unless reporting is enabled. */
let statsCache = null

/** Today's key in the local days map, in UTC to match the report cadence. */
function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10)
}

/** Empty counters for a profile that never recorded usage. */
function defaultStats() {
  const now = new Date().toISOString()
  return {
    version: 1,
    installId: randomUUID(),
    createdAt: now,
    manager: { pageOpen: 0, check: 0, install: 0, update: 0, remove: 0, toggle: 0, report: 0 },
    plugins: {},
    days: {},
    lastReport: null,
  }
}

/** Normalise a stats file so a torn or hand-edited value cannot break a page. */
function normaliseStats(raw) {
  const stats = defaultStats()
  if (raw === null || typeof raw !== 'object') return stats
  if (typeof raw.installId === 'string' && raw.installId.length >= 8) stats.installId = raw.installId
  if (typeof raw.createdAt === 'string') stats.createdAt = raw.createdAt
  if (raw.manager !== null && typeof raw.manager === 'object') {
    for (const key of Object.keys(stats.manager)) {
      const value = Number(raw.manager[key])
      if (Number.isFinite(value) && value >= 0) stats.manager[key] = Math.floor(value)
    }
  }
  if (raw.plugins !== null && typeof raw.plugins === 'object') {
    for (const [name, entry] of Object.entries(raw.plugins)) {
      if (!own(name) || entry === null || typeof entry !== 'object') continue
      const counts = {}
      for (const [event, value] of Object.entries(entry.counts ?? {})) {
        const count = Number(value)
        if (EVENT_KEY.test(event) && Number.isFinite(count) && count >= 0) counts[event] = Math.floor(count)
      }
      stats.plugins[name] = {
        firstSeen: typeof entry.firstSeen === 'string' ? entry.firstSeen : stats.createdAt,
        lastSeen: typeof entry.lastSeen === 'string' ? entry.lastSeen : stats.createdAt,
        counts,
      }
    }
  }
  if (raw.days !== null && typeof raw.days === 'object') {
    for (const [day, bucket] of Object.entries(raw.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || bucket === null || typeof bucket !== 'object') continue
      const total = Number(bucket.total)
      stats.days[day] = Number.isFinite(total) && total >= 0 ? { total: Math.floor(total) } : { total: 0 }
    }
  }
  stats.lastReport = raw.lastReport ?? null
  return stats
}

/** Read stats once per process; every mutation writes the same cached object. */
function readStats() {
  if (statsCache !== null) return statsCache
  let raw = null
  try {
    raw = JSON.parse(readFileSync(STATS_FILE, 'utf8'))
  } catch (error) {
    raw = null
  }
  statsCache = normaliseStats(raw)
  return statsCache
}

/** Persist stats atomically. */
function writeStats(stats) {
  statsCache = stats
  mkdirSync(dirname(STATS_FILE), { recursive: true })
  const temporary = STATS_FILE + '.' + String(process.pid) + '.tmp'
  writeFileSync(temporary, JSON.stringify(stats, null, 2) + '\n')
  renameSync(temporary, STATS_FILE)
}

/** Keep the local days map bounded; 90 days is enough for a quarter view. */
function trimDays(stats) {
  const keys = Object.keys(stats.days).sort()
  for (const key of keys.slice(0, Math.max(0, keys.length - 90))) delete stats.days[key]
}

/** Allowed event names: short camelCase identifiers shared by every plugin. */
const EVENT_KEY = /^[a-z][a-zA-Z0-9]{0,40}$/

/** Record one feature use for an icex plugin; no-op for foreign names and bad events. */
function recordUsage(plugin, event, count = 1) {
  if (!own(plugin) || typeof event !== 'string' || !EVENT_KEY.test(event)) return false
  const stats = readStats()
  const now = new Date()
  const iso = now.toISOString()
  const entry = stats.plugins[plugin] ?? { firstSeen: iso, lastSeen: iso, counts: {} }
  entry.lastSeen = iso
  entry.counts[event] = (entry.counts[event] ?? 0) + Math.max(1, Math.floor(count))
  stats.plugins[plugin] = entry
  const key = dayKey(now)
  const bucket = stats.days[key] ?? { total: 0 }
  bucket.total += Math.max(1, Math.floor(count))
  stats.days[key] = bucket
  trimDays(stats)
  writeStats(stats)
  return true
}

/** Record one manager action (page open, install, update…). */
function recordManager(event) {
  if (!Object.prototype.hasOwnProperty.call(readStats().manager, event)) return false
  const stats = readStats()
  stats.manager[event] += 1
  const key = dayKey()
  const bucket = stats.days[key] ?? { total: 0 }
  bucket.total += 1
  stats.days[key] = bucket
  trimDays(stats)
  writeStats(stats)
  return true
}

/** Read the running DSH version when the packaged app exposes one. */
function appVersion() {
  try {
    const base = typeof process.resourcesPath === 'string' ? process.resourcesPath : ''
    if (base === '') return null
    const pkg = JSON.parse(readFileSync(join(base, 'app.asar', 'package.json'), 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch (error) {
    return null
  }
}

/** Build the aggregate payload sent to the reporting endpoint. */
async function buildReport(manager) {
  const stats = readStats()
  const bundles = await manager.listBundles().catch(() => [])
  const byName = new Map(bundles.map((bundle) => [bundle.name, bundle]))
  const names = CATALOG.map((item) => item.name)
  for (const bundle of bundles) if (own(bundle.name) && !names.includes(bundle.name)) names.push(bundle.name)
  const plugins = names.map((name) => {
    const bundle = byName.get(name)
    return {
      name,
      version: bundle?.version ?? null,
      installed: bundle?.installed === true,
      enabled: bundle?.enabled === true,
      counts: stats.plugins[name]?.counts ?? {},
    }
  })
  return {
    schema: 1,
    installId: stats.installId,
    generatedAt: new Date().toISOString(),
    appVersion: appVersion(),
    platform: process.platform,
    arch: process.arch,
    locale: process.env.LC_ALL ?? process.env.LANG ?? null,
    nickname: readConfig().telemetry.nickname,
    manager: stats.manager,
    plugins,
    days: Object.keys(stats.days)
      .sort()
      .slice(-30)
      .map((day) => ({ day, total: stats.days[day].total })),
  }
}

/** Send the current aggregate snapshot; failures are recorded and never thrown. */
async function reportNow(manager, options = {}) {
  const config = readConfig()
  const telemetry = config.telemetry
  if (telemetry.enabled !== true) return { ok: false, code: 'disabled', message: '匿名上报未开启。' }
  if (telemetry.endpoint === '') return { ok: false, code: 'no-endpoint', message: '还没有填写接收地址。' }
  const payload = await buildReport(manager)
  const at = new Date().toISOString()
  const stats = readStats()
  let dispatcher = null
  try {
    if (telemetry.proxy !== '') {
      try {
        const { ProxyAgent } = await import('undici')
        dispatcher = new ProxyAgent(telemetry.proxy)
      } catch (error) {
        stats.lastReport = {
          at,
          ok: false,
          error: '代理组件不可用，请检查代理地址。',
          automatic: options.automatic === true,
        }
        writeStats(stats)
        return { ok: false, code: 'proxy-unavailable', message: stats.lastReport.error }
      }
    }
    const response = await fetch(telemetry.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...payload, automatic: options.automatic === true }),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
      ...(dispatcher === null ? {} : { dispatcher }),
    })
    stats.lastReport = {
      at,
      ok: response.ok,
      status: response.status,
      automatic: options.automatic === true,
    }
    writeStats(stats)
    recordManager('report')
    return { ok: response.ok, status: response.status }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stats.lastReport = {
      at,
      ok: false,
      error: message === 'The operation was aborted due to timeout' ? '上报超时：请检查网络或填写代理地址。' : message,
      automatic: options.automatic === true,
    }
    writeStats(stats)
    return { ok: false, code: 'report-failed', message: stats.lastReport.error }
  } finally {
    try {
      if (dispatcher !== null && typeof dispatcher.close === 'function') await dispatcher.close()
    } catch (error) {
      // The report result is already recorded; closing a proxy is best effort.
    }
  }
}

/** The last report is due after one interval; a manual report resets the clock. */
function reportDue() {
  const stats = readStats()
  if (stats.lastReport === null || typeof stats.lastReport.at !== 'string') return true
  const at = Date.parse(stats.lastReport.at)
  if (!Number.isFinite(at)) return true
  return Date.now() - at >= REPORT_INTERVAL_MS
}

/** Local snapshot for the page: no install-wide identifiers beyond the short id. */
function statsSnapshot() {
  const stats = readStats()
  return {
    installId: stats.installId,
    createdAt: stats.createdAt,
    manager: stats.manager,
    plugins: stats.plugins,
    days: Object.keys(stats.days)
      .sort()
      .slice(-30)
      .map((day) => ({ day, total: stats.days[day].total })),
    lastReport: stats.lastReport,
  }
}

/** Build the page state: catalog order first, then any other installed icex bundle. */
async function readState(manager) {
  const all = await manager.listBundles()
  const byName = new Map(all.map((bundle) => [bundle.name, bundle]))
  const names = []
  for (const item of CATALOG) names.push(item.name)
  for (const bundle of all) {
    if (own(bundle.name) && !names.includes(bundle.name)) names.push(bundle.name)
  }
  const bundles = names.map((name) => {
    const bundle = byName.get(name)
    const entry = CATALOG.find((item) => item.name === name)
    if (bundle === undefined) {
      return {
        name,
        title: entry?.title ?? '',
        summary: entry?.summary ?? '',
        description: entry?.summary ?? entry?.description ?? '',
        version: null,
        installed: false,
        enabled: false,
        availability: 'missing',
        update: null,
        removable: false,
        error: null,
        self: name === SELF,
      }
    }
    return {
      name,
      title: entry?.title ?? '',
      summary: entry?.summary ?? '',
      description: entry?.summary ?? bundle.description ?? entry?.description ?? '',
      version: bundle.version ?? null,
      installed: bundle.installed === true,
      enabled: bundle.enabled === true,
      availability: bundle.availability,
      update: bundle.update ?? null,
      removable: bundle.removable === true,
      error: bundle.error?.code ?? null,
      self: name === SELF,
    }
  })
  const config = readConfig()
  return { ok: true, bundles, config, lastCheck: config.lastCheck }
}

/** Latest installable version of one registry bundle, or null when already current. */
async function latestFor(manager, name) {
  const bundle = (await manager.listBundles()).find((item) => item.name === name)
  if (bundle === undefined || bundle.installed !== true) throw new Error('插件尚未安装：' + name)
  if (bundle.update !== 'registry') throw new Error('该插件不支持自动更新：' + name)
  const list = await manager.listVersions(name, {})
  if (list.status !== 'listed') throw new Error('读取版本失败：' + list.reason)
  const newest = list.versions.find((version) => version.incompatible === undefined && version.bundle !== false)
  if (newest === undefined) return { bundle, list, version: null }
  return { bundle, list, version: newest }
}

/** Check every installed registry bundle; never throws for one package's failure. */
async function checkAll(manager) {
  const bundles = (await manager.listBundles()).filter(
    (bundle) => own(bundle.name) && bundle.installed === true && bundle.update === 'registry',
  )
  const updates = {}
  const failed = {}
  for (const bundle of bundles) {
    try {
      const { version } = await latestFor(manager, bundle.name)
      if (version !== null) {
        updates[bundle.name] = {
          installed: bundle.version ?? null,
          latest: version.version,
          publishedAt: version.publishedAt ?? null,
        }
      }
    } catch (error) {
      failed[bundle.name] = error instanceof Error ? error.message : String(error)
    }
  }
  return { updates, failed, checked: bundles.length }
}

/** Update one bundle to its newest compatible release. */
async function updateOne(manager, name) {
  const { bundle, list, version } = await latestFor(manager, name)
  if (version === null) return { status: 'current', version: bundle.version ?? null }
  const requestId = randomUUID()
  const result = await manager.updateBundle(name, version.version, {
    requestId,
    ...(list.registry === null || list.registry === undefined ? {} : { registry: list.registry }),
  })
  return { status: 'updated', from: bundle.version ?? null, to: version.version, result }
}

/** Install one catalog bundle at the registry's latest version. */
async function installOne(manager, name) {
  const bundles = await manager.listBundles()
  const existing = bundles.find((item) => item.name === name)
  if (existing?.installed === true) throw new Error('已经安装：' + name)
  const requestId = randomUUID()
  return manager.installBundle(name, { enabled: true, requestId })
}

/** Per-profile operation queue; pnpm runs must not overlap. */
let busy = false

/** Run one operation exclusively and translate thrown errors into JSON. */
async function exclusive(work) {
  if (busy) return jsonResponse({ ok: false, code: 'busy', message: '另一个插件操作正在进行，请稍后再试。' }, 409)
  busy = true
  try {
    return jsonResponse({ ok: true, result: await work() })
  } catch (error) {
    return jsonResponse(
      { ok: false, code: 'operation-failed', message: error instanceof Error ? error.message : String(error) },
      500,
    )
  } finally {
    busy = false
  }
}

/** Read a JSON request body without assuming a content type. */
async function readBody(request) {
  try {
    const body = await request.json()
    return body !== null && typeof body === 'object' ? body : {}
  } catch (error) {
    return {}
  }
}

/** Register one buffered route. The route table only matches methods given as an array. */
function route(connection, path, methods, fetch) {
  const list = Array.isArray(methods) ? methods : [methods]
  return connection.fetch.register({ path, methods: list, requestBody: 'buffered', fetch })
}

/** Persist a check result, keeping the previous one when the new check failed entirely. */
function recordCheck(check) {
  const config = readConfig()
  config.lastCheck = check
  writeConfig(config)
}

/** One automatic-update pass: check, then update the packages whose toggle is on. */
async function autoUpdatePass(manager) {
  const config = readConfig()
  if (!config.autoUpdate.enabled) return null
  const targets = Object.entries(config.autoUpdate.packages)
    .filter(([, enabled]) => enabled === true)
    .map(([name]) => name)
  if (targets.length === 0) return null
  if (busy) return null
  busy = true
  try {
    const check = await checkAll(manager)
    const results = []
    for (const name of targets) {
      if (check.updates[name] === undefined) continue
      try {
        const outcome = await updateOne(manager, name)
        results.push({ name, ok: true, ...outcome })
      } catch (error) {
        results.push({ name, ok: false, message: error instanceof Error ? error.message : String(error) })
      }
    }
    recordCheck({
      at: new Date().toISOString(),
      automatic: true,
      updates: check.updates,
      failed: check.failed,
      results,
    })
    return results
  } catch (error) {
    recordCheck({
      at: new Date().toISOString(),
      automatic: true,
      updates: {},
      failed: { '*': error instanceof Error ? error.message : String(error) },
      results: [],
    })
    return []
  } finally {
    busy = false
  }
}

/**
 * Serve the plugin-center routes and run the automatic-update timer while the
 * host owns PluginManager.
 * @param ctx - owning Cordis context.
 */
export function apply(ctx) {
  logHost('apply start')
  try {
    ctx.effect(
      () => (ctx.reflect ?? ctx).provide('icexStats', { record: recordUsage }),
      'icex-plugin-center: stats service',
    )
    logHost('icexStats service provided')
  } catch (error) {
    // Usage counters stay local if the Host cannot expose the service.
  }

  try {
  ctx.inject(['connection'], (scope) => {
    logHost('connection scope ready')
    const connection = scope.connection
    const resolveManager = () => {
      const manager = typeof scope.get === 'function' ? scope.get('pluginManager') : undefined
      if (manager === undefined || manager === null) throw new Error('pluginManager service is not available')
      return manager
    }

    scope.effect(
      () => route(connection, '/api/icex-plugin-center/ping', 'GET', async () => jsonResponse({ ok: true })),
      'icex-plugin-center: ping route',
    )
    logHost('routes registered')

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/state', 'GET', async () => {
          try {
            return jsonResponse(await readState(resolveManager()))
          } catch (error) {
            return jsonResponse({ ok: false, code: 'state-failed', message: String(error) }, 500)
          }
        }),
      'icex-plugin-center: state route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/check', 'POST', async () => {
          if (busy) return jsonResponse({ ok: false, code: 'busy', message: '另一个插件操作正在进行，请稍后再试。' }, 409)
          busy = true
          try {
            const check = await checkAll(resolveManager())
            recordCheck({ at: new Date().toISOString(), automatic: false, ...check, results: [] })
            recordManager('check')
            return jsonResponse({ ok: true, ...check })
          } catch (error) {
            return jsonResponse({ ok: false, code: 'check-failed', message: String(error) }, 500)
          } finally {
            busy = false
          }
        }),
      'icex-plugin-center: check route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/install', 'POST', async (request) => {
          const body = await readBody(request)
          const name = String(body.name ?? '')
          if (!own(name)) return jsonResponse({ ok: false, code: 'invalid-name', message: '不是 icex 插件。' }, 400)
          if (name === SELF) return jsonResponse({ ok: false, code: 'self', message: '插件中心不需要安装自己。' }, 400)
          return exclusive(async () => {
            const result = await installOne(resolveManager(), name)
            recordManager('install')
            return result
          })
        }),
      'icex-plugin-center: install route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/update', 'POST', async (request) => {
          const body = await readBody(request)
          const name = String(body.name ?? '')
          if (!own(name)) return jsonResponse({ ok: false, code: 'invalid-name', message: '不是 icex 插件。' }, 400)
          return exclusive(async () => {
            const result = await updateOne(resolveManager(), name)
            recordManager('update')
            return result
          })
        }),
      'icex-plugin-center: update route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/remove', 'POST', async (request) => {
          const body = await readBody(request)
          const name = String(body.name ?? '')
          if (!own(name)) return jsonResponse({ ok: false, code: 'invalid-name', message: '不是 icex 插件。' }, 400)
          if (name === SELF) return jsonResponse({ ok: false, code: 'self', message: '不能移除正在使用的插件中心。' }, 400)
          return exclusive(async () => {
            const result = await resolveManager().removeBundle(name)
            recordManager('remove')
            return result
          })
        }),
      'icex-plugin-center: remove route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/toggle', 'POST', async (request) => {
          const body = await readBody(request)
          const name = String(body.name ?? '')
          const enabled = body.enabled === true
          if (!own(name)) return jsonResponse({ ok: false, code: 'invalid-name', message: '不是 icex 插件。' }, 400)
          if (name === SELF) {
            return jsonResponse({ ok: false, code: 'self', message: '请从官方插件页停用插件中心。' }, 400)
          }
          return exclusive(async () => {
            const result = await resolveManager().setBundleEnabled(name, enabled)
            recordManager('toggle')
            return result
          })
        }),
      'icex-plugin-center: toggle route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/stats', 'GET', async () => {
          return jsonResponse({ ok: true, stats: statsSnapshot(), telemetry: readConfig().telemetry })
        }),
      'icex-plugin-center: stats route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/stats/event', 'POST', async (request) => {
          const body = await readBody(request)
          const event = String(body.event ?? '')
          const allowed = new Set(['pageOpen'])
          if (!allowed.has(event)) return jsonResponse({ ok: false, code: 'invalid-event', message: '未知事件。' }, 400)
          recordManager(event)
          return jsonResponse({ ok: true })
        }),
      'icex-plugin-center: stats event route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/report', 'POST', async () => {
          const result = await reportNow(resolveManager(), { automatic: false })
          return jsonResponse(result, result.ok === true ? 200 : 400)
        }),
      'icex-plugin-center: report route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/config', 'POST', async (request) => {
          const body = await readBody(request)
          const current = readConfig()
          const auto = body.autoUpdate
          if (auto !== null && typeof auto === 'object') {
            if (typeof auto.enabled === 'boolean') current.autoUpdate.enabled = auto.enabled
            const hours = Number(auto.intervalHours)
            if (Number.isFinite(hours)) {
              current.autoUpdate.intervalHours = Math.min(MAX_INTERVAL_HOURS, Math.max(MIN_INTERVAL_HOURS, Math.round(hours)))
            }
            if (auto.packages !== null && typeof auto.packages === 'object') {
              for (const [name, value] of Object.entries(auto.packages)) {
                if (!own(name)) continue
                if (value === true) current.autoUpdate.packages[name] = true
                else delete current.autoUpdate.packages[name]
              }
            }
          }
          const telemetry = body.telemetry
          if (telemetry !== null && typeof telemetry === 'object') {
            if (typeof telemetry.enabled === 'boolean') {
              current.telemetry.enabled = telemetry.enabled
              if (telemetry.enabled) current.telemetry.decidedAt = new Date().toISOString()
            }
            if (Object.prototype.hasOwnProperty.call(telemetry, 'endpoint')) {
              current.telemetry.endpoint = cleanEndpoint(telemetry.endpoint)
            }
            if (Object.prototype.hasOwnProperty.call(telemetry, 'nickname')) {
              current.telemetry.nickname = String(telemetry.nickname ?? '').trim().slice(0, 40)
            }
            if (Object.prototype.hasOwnProperty.call(telemetry, 'proxy')) {
              current.telemetry.proxy = cleanEndpoint(telemetry.proxy)
            }
          }
          writeConfig(current)
          return jsonResponse({ ok: true, config: current })
        }),
      'icex-plugin-center: config route',
    )

    scope.effect(() => {
      let disposed = false
      let timer = null
      const schedule = (milliseconds) => {
        timer = setTimeout(run, milliseconds)
      }
      const run = async () => {
        if (disposed) return
        try {
          await autoUpdatePass(resolveManager())
        } catch (error) {
          // A failed pass is recorded inside autoUpdatePass; never stop the timer.
        }
        if (disposed) return
        const hours = readConfig().autoUpdate.intervalHours
        schedule(Math.max(1, hours) * 60 * 60 * 1000)
      }
      schedule(FIRST_DELAY_MS)
      return () => {
        disposed = true
        if (timer !== null) clearTimeout(timer)
      }
    }, 'icex-plugin-center: automatic updates')

    scope.effect(() => {
      let disposed = false
      let timer = null
      const tick = async () => {
        if (disposed) return
        try {
          const telemetry = readConfig().telemetry
          if (telemetry.enabled === true && telemetry.endpoint !== '' && reportDue()) {
            await reportNow(resolveManager(), { automatic: true })
          }
        } catch (error) {
          // Reporting is best effort and must never break the page.
        }
        if (disposed) return
        timer = setTimeout(tick, 60 * 60 * 1000)
      }
      timer = setTimeout(tick, 60_000)
      return () => {
        disposed = true
        if (timer !== null) clearTimeout(timer)
      }
    }, 'icex-plugin-center: anonymous reporting')
  })
  logHost('timers armed')
  } catch (error) {
    logHost(`inject failed: ${String(error)}`)
  }
}

export const __test = {
  SELF,
  CATALOG,
  CONFIG_FILE,
  STATS_FILE,
  defaultConfig,
  normaliseConfig,
  readConfig,
  writeConfig,
  own,
  readState,
  latestFor,
  checkAll,
  updateOne,
  installOne,
  autoUpdatePass,
  defaultStats,
  normaliseStats,
  readStats,
  writeStats,
  recordUsage,
  recordManager,
  reportDue,
  buildReport,
  reportNow,
  statsSnapshot,
  resetStats: () => {
    statsCache = null
    try {
      unlinkSync(STATS_FILE)
    } catch (error) {
      // A missing stats file is already a clean slate.
    }
  },
}

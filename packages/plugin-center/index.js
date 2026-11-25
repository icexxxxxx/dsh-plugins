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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** This bundle never removes or disables itself from its own page. */
const SELF = 'icex-dsh-plugin-center'

/** Plugins the page offers before they are installed. Titles come from the client dictionaries. */
const CATALOG = [
  { name: 'icex-dsh-fixer', description: '输入锚点导航、编辑已发消息并分支重发、右 Option 唤起窗口。' },
  { name: 'icex-dsh-memory', description: '跨会话记忆：自动发掘、候选确认、新会话注入。' },
  { name: SELF, description: '在一个页面里安装、更新、启停 icex 插件，并可自动更新。' },
]

const DSH_HOME = process.env.DSH_HOME && process.env.DSH_HOME !== '' ? process.env.DSH_HOME : join(homedir(), '.dsh')
const CONFIG_FILE = join(DSH_HOME, 'plugin-center', 'config.json')
const FIRST_DELAY_MS = 20_000
const MIN_INTERVAL_HOURS = 1
const MAX_INTERVAL_HOURS = 168

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
  config.lastCheck = raw.lastCheck ?? null
  return config
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
        description: entry?.description ?? '',
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
      description: bundle.description ?? entry?.description ?? '',
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

/** Register one buffered route. */
function route(connection, path, methods, fetch) {
  return connection.fetch.register({ path, methods, requestBody: 'buffered', fetch })
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
  ctx.inject(['connection', 'pluginManager'], (scope) => {
    const connection = scope.connection
    const manager = scope.pluginManager

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/state', 'GET', async () => {
          try {
            return jsonResponse(await readState(manager))
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
            const check = await checkAll(manager)
            recordCheck({ at: new Date().toISOString(), automatic: false, ...check, results: [] })
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
          return exclusive(() => installOne(manager, name))
        }),
      'icex-plugin-center: install route',
    )

    scope.effect(
      () =>
        route(connection, '/api/icex-plugin-center/update', 'POST', async (request) => {
          const body = await readBody(request)
          const name = String(body.name ?? '')
          if (!own(name)) return jsonResponse({ ok: false, code: 'invalid-name', message: '不是 icex 插件。' }, 400)
          return exclusive(() => updateOne(manager, name))
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
          return exclusive(() => manager.removeBundle(name))
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
          return exclusive(() => manager.setBundleEnabled(name, enabled))
        }),
      'icex-plugin-center: toggle route',
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
          await autoUpdatePass(manager)
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
  })
}

export const __test = {
  SELF,
  CATALOG,
  CONFIG_FILE,
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
}

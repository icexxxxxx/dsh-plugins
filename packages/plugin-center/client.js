/**
 * icex-dsh-plugin-center client bundle.
 *
 * A standalone sidebar page (not a tab inside the official Plugins page): it
 * lists the icex plugins, installs and updates them with one click, and keeps
 * per-plugin automatic updates. Every mutation goes through the host routes
 * served by index.js, which in turn call the profile's PluginManager.
 *
 * Hand-written in the module-loader factory format, so it needs no build step.
 */
window.__ModuleLoader__.load({
  id: 'icex-dsh-plugin-center',
  factory(require) {
    const React = require('react')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const useCallback = React.useCallback
    const useEffect = React.useEffect
    const useMemo = React.useMemo
    const useState = React.useState

    const PACKAGE = 'icex-dsh-plugin-center'
    const NS = 'icex-dsh-plugin-center'
    const PANEL_ID = 'icex-plugins'
    const SELF = PACKAGE
    const NEWLINE = String.fromCharCode(10)

    /** Captured in apply for locale binding. */
    let runtimeContext = null

    const en = {
      panel: 'Plugin Center',
      title: 'My plugins',
      subtitle: 'Install, update and keep the icex plugins current — no terminal needed.',
      autoUpdate: 'Automatic updates',
      autoUpdateHint: 'Check the registry and update the plugins you enable below.',
      interval: 'Check every',
      hours: 'hours',
      hour: 'hour',
      checkNow: 'Check now',
      refresh: 'Refresh',
      checking: 'Checking…',
      installing: 'Installing…',
      updating: 'Updating…',
      removing: 'Removing…',
      install: 'Install',
      update: 'Update',
      enable: 'Enable',
      disable: 'Disable',
      remove: 'Remove',
      running: 'Running',
      stopped: 'Disabled',
      absent: 'Not installed',
      current: 'Up to date',
      newVersion: 'New version',
      selfTitle: 'Plugin Center',
      self: 'This page',
      perPlugin: 'Auto-update',
      lastCheck: 'Last check',
      never: 'Never checked',
      checkedSummary: 'checked {count} plugins, {updates} updates available',
      failed: 'Some checks failed: {names}',
      empty: 'No icex plugins yet — install one below.',
      restart: 'Restart DSH for the change to take effect.',
      updated: 'Updated to v{version}.',
      installed: 'Installed. Open the sidebar entry after a restart.',
      removed: 'Removed.',
      toggled: 'Saved.',
      error: 'Something went wrong',
      loadFailed: 'Could not read the plugin list',
      unavailable: 'The plugin manager is not available in this profile.',
    }

    const zh = {
      panel: '插件中心',
      title: '我的插件',
      subtitle: '安装、更新、自动升级 icex 插件，全程点击完成。',
      autoUpdate: '自动更新',
      autoUpdateHint: '定期检查 npm 并升级下面开启了的插件。',
      interval: '检查间隔',
      hours: '小时',
      hour: '小时',
      checkNow: '立即检查',
      refresh: '刷新',
      checking: '检查中…',
      installing: '安装中…',
      updating: '更新中…',
      removing: '移除中…',
      install: '安装',
      update: '更新',
      enable: '启用',
      disable: '停用',
      remove: '移除',
      running: '运行中',
      stopped: '已停用',
      absent: '未安装',
      current: '已是最新',
      newVersion: '新版本',
      selfTitle: '插件中心',
      self: '当前页面',
      perPlugin: '自动更新',
      lastCheck: '上次检查',
      never: '还没检查过',
      checkedSummary: '已检查 {count} 个插件，发现 {updates} 个更新',
      failed: '部分检查失败：{names}',
      empty: '还没有安装 icex 插件。',
      restart: '重启 DSH 后生效。',
      updated: '已更新到 v{version}。',
      installed: '已安装，重启后可在侧栏打开。',
      removed: '已移除。',
      toggled: '已保存。',
      error: '出错了',
      loadFailed: '读取插件列表失败',
      unavailable: '当前 profile 没有可用的插件管理器。',
    }

    /** Fill {name} placeholders. */
    function format(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) =>
        Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
      )
    }

    /** Strip the package prefix and capitalise the rest for the card title. */
    function shortName(name) {
      const tail = String(name).startsWith('icex-dsh-') ? String(name).slice('icex-dsh-'.length) : String(name)
      return tail
        .split('-')
        .map((part) => (part === '' ? part : part[0].toUpperCase() + part.slice(1)))
        .join(' ')
    }

    /** Card title: the client dictionary first, the package name second. */
    function titleOf(item, t) {
      if (item.name === SELF) return t('selfTitle')
      return item.title !== '' ? item.title : shortName(item.name)
    }

    /** Status key for one bundle. */
    function statusOf(item) {
      if (item.installed !== true) return 'absent'
      return item.enabled === true ? 'running' : 'stopped'
    }

    /** One API call against the host half. */
    async function api(path, body) {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
      })
      let payload = null
      try {
        payload = await response.json()
      } catch (error) {
        payload = null
      }
      if (!response.ok || payload === null || payload.ok !== true) {
        throw new Error(payload?.message ?? 'HTTP ' + String(response.status))
      }
      return payload
    }

    /** Read the whole page state. */
    async function fetchState() {
      const response = await fetch('/api/icex-plugin-center/state', { headers: { accept: 'application/json' } })
      const payload = await response.json().catch(() => null)
      if (!response.ok || payload === null || payload.ok !== true) {
        throw new Error(payload?.message ?? 'HTTP ' + String(response.status))
      }
      return payload
    }

    /** Local mirror of the auto-update config, so a toggle reacts before the round trip. */
    function patchConfig(config, change) {
      const next = {
        ...config,
        autoUpdate: {
          ...config.autoUpdate,
          ...change,
        },
      }
      if (change.packages !== undefined) {
        next.autoUpdate.packages = { ...config.autoUpdate.packages, ...change.packages }
      }
      return next
    }

    /** Icon glyph shared with the sidebar entry. */
    function PluginsGlyph({ size = 18 }) {
      const Icon = primitives.IconPluginPinwheelOutlineRegular
      if (typeof Icon === 'function') return h(Icon, { size })
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 },
        h('rect', { x: 3, y: 3, width: 7, height: 7, rx: 1.6 }),
        h('rect', { x: 14, y: 3, width: 7, height: 7, rx: 1.6 }),
        h('rect', { x: 3, y: 14, width: 7, height: 7, rx: 1.6 }),
        h('path', { d: 'M17.5 14v7M14 17.5h7' }),
      )
    }

    /** The sidebar entry icon; the sidebar owns the surrounding button. */
    function MyPluginsIcon({ size }) {
      return h(PluginsGlyph, { size })
    }

    /** Status pill. */
    function StatusPill({ status, t }) {
      return h('span', { className: 'icex-pc-pill icex-pc-pill-' + status }, t(status))
    }

    /** A small switch with a label. */
    function Switch({ checked, disabled, onChange, label }) {
      return h(
        'label',
        { className: 'icex-pc-switch' + (disabled ? ' is-disabled' : '') },
        h('input', {
          type: 'checkbox',
          checked: checked === true,
          disabled: disabled === true,
          'aria-label': label,
          onChange: (event) => onChange(event.target.checked),
        }),
        h('span', { className: 'icex-pc-switch-track' }, h('span', { className: 'icex-pc-switch-knob' })),
      )
    }

    /** Whole-page component. */
    function PluginCenterPage() {
      const ctx = runtimeContext
      const t = useMemo(() => (ctx === null ? (key) => key : ctx.locale.bind(NS)), [ctx])
      const [view, setView] = useState({ status: 'loading', data: null, error: null })
      const [busy, setBusy] = useState(null)
      const [checking, setChecking] = useState(false)
      const [updates, setUpdates] = useState({})
      const [notice, setNotice] = useState(null)

      const refresh = useCallback(() => {
        let live = true
        fetchState()
          .then((data) => {
            if (live) setView({ status: 'ready', data, error: null })
          })
          .catch((error) => {
            if (live) setView((current) => ({ status: 'error', data: current.data, error: error.message }))
          })
        return () => {
          live = false
        }
      }, [])

      useEffect(() => refresh(), [refresh])

      useEffect(() => {
        if (notice === null) return undefined
        const timer = setTimeout(() => setNotice(null), 4200)
        return () => clearTimeout(timer)
      }, [notice])

      const config = view.data?.config ?? { autoUpdate: { enabled: false, intervalHours: 6, packages: {} } }
      const auto = config.autoUpdate

      /** Persist one config change. */
      const saveConfig = useCallback(
        (change) => {
          if (view.data === null) return
          const next = patchConfig(config, change)
          setView((current) => ({ ...current, data: { ...current.data, config: next } }))
          api('/api/icex-plugin-center/config', { autoUpdate: change }).catch((error) => {
            setNotice({ kind: 'error', text: error.message })
            refresh()
          })
        },
        [config, refresh, view.data],
      )

      /** Run one bundle operation and refresh afterwards. */
      const operate = useCallback(
        async (name, kind) => {
          if (busy !== null) return
          setBusy(name)
          setNotice(null)
          try {
            if (kind === 'install') {
              await api('/api/icex-plugin-center/install', { name })
              setNotice({ kind: 'ok', text: t('installed') })
            } else if (kind === 'update') {
              const payload = await api('/api/icex-plugin-center/update', { name })
              const result = payload.result
              const version = result?.to ?? result?.version ?? ''
              const restart = result?.result?.application === 'restart-required' || result?.result?.application === 'overridden'
              setNotice({
                kind: 'ok',
                text: format(t('updated'), { version }) + (restart ? ' ' + t('restart') : ''),
              })
            } else if (kind === 'remove') {
              await api('/api/icex-plugin-center/remove', { name })
              setNotice({ kind: 'ok', text: t('removed') })
            } else if (kind === 'toggle') {
              const item = view.data?.bundles.find((bundle) => bundle.name === name)
              await api('/api/icex-plugin-center/toggle', { name, enabled: item?.enabled !== true })
              setNotice({ kind: 'ok', text: t('toggled') })
            }
          } catch (error) {
            setNotice({ kind: 'error', text: error.message })
          } finally {
            setBusy(null)
            refresh()
          }
        },
        [busy, refresh, t, view.data],
      )

      /** Ask the host to check every installed plugin. */
      const checkNow = useCallback(async () => {
        if (checking) return
        setChecking(true)
        setNotice(null)
        try {
          const payload = await api('/api/icex-plugin-center/check', {})
          setUpdates(payload.updates ?? {})
          const count = Object.keys(payload.updates ?? {}).length
          setNotice({
            kind: 'ok',
            text: format(t('checkedSummary'), { count: payload.checked ?? 0, updates: count }),
          })
          refresh()
        } catch (error) {
          setNotice({ kind: 'error', text: error.message })
        } finally {
          setChecking(false)
        }
      }, [checking, refresh, t])

      const bundles = view.data?.bundles ?? []
      const lastCheck = view.data?.lastCheck ?? null

      if (view.status === 'loading') {
        return h('div', { className: 'icex-pc' }, h('div', { className: 'icex-pc-loading' }, t('loading')))
      }
      if (view.status === 'error' && view.data === null) {
        return h(
          'div',
          { className: 'icex-pc' },
          h('div', { className: 'icex-pc-error' }, h('strong', null, t('loadFailed')), h('span', null, view.error)),
        )
      }

      return h(
        'div',
        { className: 'icex-pc' },
        h(
          'header',
          { className: 'icex-pc-header' },
          h('div', { className: 'icex-pc-header-icon' }, h(PluginsGlyph, { size: 22 })),
          h(
            'div',
            null,
            h('h1', { className: 'icex-pc-title' }, t('title')),
            h('p', { className: 'icex-pc-subtitle' }, t('subtitle')),
          ),
        ),
        h(
          'section',
          { className: 'icex-pc-toolbar' },
          h(
            'div',
            { className: 'icex-pc-toolbar-main' },
            h(Switch, {
              checked: auto.enabled,
              label: t('autoUpdate'),
              onChange: (checked) => saveConfig({ enabled: checked }),
            }),
            h('div', { className: 'icex-pc-toolbar-text' }, h('strong', null, t('autoUpdate')), h('span', null, t('autoUpdateHint'))),
          ),
          h(
            'div',
            { className: 'icex-pc-toolbar-side' },
            h(
              'label',
              { className: 'icex-pc-interval' },
              h('span', null, t('interval')),
              h(
                'select',
                {
                  value: String(auto.intervalHours),
                  disabled: !auto.enabled,
                  onChange: (event) => saveConfig({ intervalHours: Number(event.target.value) }),
                },
                [1, 6, 12, 24, 48].map((hours) =>
                  h('option', { key: hours, value: String(hours) }, String(hours) + ' ' + (hours === 1 ? t('hour') : t('hours'))),
                ),
              ),
            ),
            h(
              'button',
              { className: 'icex-pc-btn', type: 'button', disabled: checking || busy !== null, onClick: checkNow },
              checking ? t('checking') : t('checkNow'),
            ),
            h(
              'button',
              { className: 'icex-pc-btn icex-pc-btn-quiet', type: 'button', onClick: refresh },
              t('refresh'),
            ),
          ),
        ),
        h(
          'section',
          { className: 'icex-pc-list' },
          bundles.length === 0
            ? h('p', { className: 'icex-pc-empty' }, t('empty'))
            : bundles.map((item) => {
                const status = statusOf(item)
                const update = updates[item.name]
                const caps = item.installed && item.update === 'registry'
                const cardBusy = busy === item.name
                return h(
                  'article',
                  { className: 'icex-pc-card', key: item.name },
                  h(
                    'div',
                    { className: 'icex-pc-card-head' },
                    h('span', { className: 'icex-pc-card-glyph' }, shortName(item.name).slice(0, 2).toUpperCase()),
                    h(
                      'div',
                      { className: 'icex-pc-card-title' },
                      h(
                        'div',
                        { className: 'icex-pc-card-name' },
                        h('span', null, titleOf(item, t)),
                        item.version !== null ? h('code', null, 'v' + item.version) : null,
                        item.self ? h('span', { className: 'icex-pc-self' }, t('self')) : null,
                      ),
                      h('p', { className: 'icex-pc-card-desc' }, item.description),
                    ),
                    h(StatusPill, { status, t }),
                  ),
                  update !== undefined
                    ? h(
                        'div',
                        { className: 'icex-pc-update' },
                        h('span', null, t('newVersion')),
                        h('code', null, 'v' + update.latest),
                        update.publishedAt !== null
                          ? h('span', { className: 'icex-pc-update-time' }, String(update.publishedAt).slice(0, 10))
                          : null,
                      )
                    : item.installed
                      ? h('div', { className: 'icex-pc-update' }, h('span', { className: 'icex-pc-current' }, t('current')))
                      : null,
                  h(
                    'div',
                    { className: 'icex-pc-card-actions' },
                    !item.installed
                      ? h(
                          'button',
                          {
                            className: 'icex-pc-btn icex-pc-btn-primary',
                            type: 'button',
                            disabled: busy !== null,
                            onClick: () => operate(item.name, 'install'),
                          },
                          cardBusy ? t('installing') : t('install'),
                        )
                      : null,
                    item.installed && update !== undefined && item.self !== true
                      ? h(
                          'button',
                          {
                            className: 'icex-pc-btn icex-pc-btn-primary',
                            type: 'button',
                            disabled: busy !== null,
                            onClick: () => operate(item.name, 'update'),
                          },
                          cardBusy ? t('updating') : t('update'),
                        )
                      : null,
                    item.installed && item.self !== true
                      ? h(
                          'button',
                          {
                            className: 'icex-pc-btn',
                            type: 'button',
                            disabled: busy !== null,
                            onClick: () => operate(item.name, 'toggle'),
                          },
                          item.enabled ? t('disable') : t('enable'),
                        )
                      : null,
                    item.installed && item.self !== true && item.removable
                      ? h(
                          'button',
                          {
                            className: 'icex-pc-btn icex-pc-btn-danger',
                            type: 'button',
                            disabled: busy !== null,
                            onClick: () => operate(item.name, 'remove'),
                          },
                          cardBusy ? t('removing') : t('remove'),
                        )
                      : null,
                    item.installed && caps
                      ? h(
                          'div',
                          { className: 'icex-pc-per-plugin' },
                          h('span', null, t('perPlugin')),
                          h(Switch, {
                            checked: auto.packages[item.name] === true,
                            disabled: auto.enabled !== true,
                            label: t('perPlugin') + ': ' + item.name,
                            onChange: (checked) => saveConfig({ packages: { [item.name]: checked } }),
                          }),
                        )
                      : null,
                  ),
                )
              }),
        ),
        h(
          'footer',
          { className: 'icex-pc-footer' },
          h(
            'div',
            null,
            h('strong', null, t('lastCheck') + '：'),
            lastCheck === null || lastCheck === undefined
              ? h('span', null, t('never'))
              : h(
                  'span',
                  null,
                  String(lastCheck.at ?? '').slice(0, 16).replace('T', ' ') +
                    ' · ' +
                    format(t('checkedSummary'), {
                      count: lastCheck.checked ?? 0,
                      updates: Object.keys(lastCheck.updates ?? {}).length,
                    }),
                ),
          ),
          lastCheck !== null && lastCheck !== undefined && Object.keys(lastCheck.failed ?? {}).length > 0
            ? h('div', { className: 'icex-pc-footer-error' }, format(t('failed'), { names: Object.keys(lastCheck.failed).join(', ') }))
            : null,
        ),
        notice === null
          ? null
          : h('div', { className: 'icex-pc-toast' + (notice.kind === 'error' ? ' is-error' : '') }, notice.text),
        view.status === 'error' && view.data !== null
          ? h('div', { className: 'icex-pc-banner' }, t('error') + '：' + view.error)
          : null,
      )
    }

    const STYLE_LINES = [
      '.icex-pc { box-sizing: border-box; width: 100%; height: 100%; max-width: 860px; margin: 0 auto; padding: 28px 32px 40px; overflow-y: auto; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }',
      '.icex-pc * { box-sizing: border-box; }',
      '.icex-pc-header { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 18px; }',
      '.icex-pc-header-icon { display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; border-radius: var(--dsw-radius-lg, 10px); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 14%, transparent); color: var(--dsw-alias-state-business-primary); }',
      '.icex-pc-title { margin: 0; font-size: 18px; line-height: 26px; font-weight: 600; }',
      '.icex-pc-subtitle { margin: 2px 0 0; color: var(--dsw-alias-label-secondary); }',
      '.icex-pc-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; margin-bottom: 20px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg, 10px); background: var(--dsw-alias-bg-layer-1); }',
      '.icex-pc-toolbar-main { display: flex; align-items: center; gap: 10px; }',
      '.icex-pc-toolbar-text { display: flex; flex-direction: column; gap: 1px; }',
      '.icex-pc-toolbar-text span { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }',
      '.icex-pc-toolbar-side { display: flex; align-items: center; gap: 8px; }',
      '.icex-pc-interval { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }',
      '.icex-pc-interval select { height: 28px; padding: 0 6px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 6px); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 11px; }',
      '.icex-pc-list { display: flex; flex-direction: column; gap: 12px; }',
      '.icex-pc-card { padding: 14px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg, 10px); background: var(--dsw-alias-bg-layer-1); }',
      '.icex-pc-card-head { display: flex; align-items: flex-start; gap: 10px; }',
      '.icex-pc-card-glyph { flex: none; display: flex; align-items: center; justify-content: center; width: 30px; height: 30px; border-radius: var(--dsw-radius-md, 6px); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); color: var(--dsw-alias-state-business-primary); font-size: 10px; font-weight: 600; letter-spacing: 0.04em; }',
      '.icex-pc-card-title { flex: 1; min-width: 0; }',
      '.icex-pc-card-name { display: flex; align-items: center; gap: 6px; font-weight: 600; }',
      '.icex-pc-card-name code, .icex-pc-update code { padding: 1px 5px; border-radius: 4px; background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 14%, transparent); color: var(--dsw-alias-label-secondary); font-size: 10px; font-weight: 400; }',
      '.icex-pc-self { padding: 1px 6px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 14%, transparent); color: var(--dsw-alias-label-tertiary); font-size: 10px; font-weight: 400; }',
      '.icex-pc-card-desc { margin: 2px 0 0; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }',
      '.icex-pc-pill { flex: none; display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 999px; font-size: 10px; line-height: 1; }',
      '.icex-pc-pill-running { background: color-mix(in srgb, var(--dsw-alias-state-success, #34c759) 16%, transparent); color: var(--dsw-alias-state-success, #2f9e50); }',
      '.icex-pc-pill-stopped { background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 16%, transparent); color: var(--dsw-alias-label-secondary); }',
      '.icex-pc-pill-absent { background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 10%, transparent); color: var(--dsw-alias-label-tertiary); }',
      '.icex-pc-update { display: flex; align-items: center; gap: 6px; margin-top: 10px; color: var(--dsw-alias-state-business-primary); font-size: 11px; }',
      '.icex-pc-update-time, .icex-pc-current { color: var(--dsw-alias-label-tertiary); }',
      '.icex-pc-card-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; }',
      '.icex-pc-btn { height: 28px; padding: 0 12px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-md, 6px); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }',
      '.icex-pc-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }',
      '.icex-pc-btn:disabled { opacity: 0.55; cursor: default; }',
      '.icex-pc-btn-primary { border-color: transparent; background: var(--dsw-alias-state-business-primary); color: #fff; }',
      '.icex-pc-btn-primary:hover:not(:disabled) { filter: brightness(1.06); background: var(--dsw-alias-state-business-primary); }',
      '.icex-pc-btn-quiet { border-color: transparent; background: transparent; color: var(--dsw-alias-label-secondary); }',
      '.icex-pc-btn-danger { border-color: transparent; background: transparent; color: var(--dsw-alias-state-error, #e5484d); }',
      '.icex-pc-per-plugin { display: flex; align-items: center; gap: 8px; margin-left: auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }',
      '.icex-pc-switch { position: relative; display: inline-flex; align-items: center; width: 36px; height: 20px; cursor: pointer; }',
      '.icex-pc-switch.is-disabled { opacity: 0.5; cursor: default; }',
      '.icex-pc-switch input { position: absolute; inset: 0; opacity: 0; margin: 0; cursor: inherit; }',
      '.icex-pc-switch-track { position: relative; width: 36px; height: 20px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 30%, transparent); transition: background 140ms ease; }',
      '.icex-pc-switch input:checked + .icex-pc-switch-track { background: var(--dsw-alias-state-business-primary); }',
      '.icex-pc-switch-knob { position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 140ms ease; }',
      '.icex-pc-switch input:checked + .icex-pc-switch-track .icex-pc-switch-knob { transform: translateX(16px); }',
      '.icex-pc-empty { margin: 0; padding: 24px; border: 0.5px dashed var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg, 10px); color: var(--dsw-alias-label-tertiary); text-align: center; }',
      '.icex-pc-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 18px; padding-top: 12px; border-top: 0.5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-tertiary); font-size: 11px; }',
      '.icex-pc-footer strong { font-weight: 500; }',
      '.icex-pc-footer-error { color: var(--dsw-alias-state-error, #e5484d); }',
      '.icex-pc-toast { position: fixed; left: 50%; bottom: 28px; z-index: 60; transform: translateX(-50%); max-width: 560px; padding: 8px 14px; border-radius: var(--dsw-radius-lg, 10px); background: var(--dsw-specific-menu, var(--dsw-alias-bg-layer-2)); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-panel); font-size: 12px; }',
      '.icex-pc-toast.is-error { color: var(--dsw-alias-state-error, #e5484d); }',
      '.icex-pc-banner { margin-top: 12px; padding: 8px 12px; border-radius: var(--dsw-radius-md, 6px); background: color-mix(in srgb, var(--dsw-alias-state-error, #e5484d) 12%, transparent); color: var(--dsw-alias-state-error, #e5484d); font-size: 11px; }',
      '.icex-pc-error { display: flex; flex-direction: column; gap: 6px; padding: 16px; border: 0.5px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg, 10px); color: var(--dsw-alias-state-error, #e5484d); }',
      '.icex-pc-loading { padding: 40px; color: var(--dsw-alias-label-tertiary); text-align: center; }',
    ]

    /** Inject the page styles once. */
    function installStyles() {
      if (typeof document === 'undefined') return function () {}
      const id = PACKAGE + ':styles'
      if (document.getElementById(id) !== null) return function () {}
      const style = document.createElement('style')
      style.id = id
      style.textContent = STYLE_LINES.join(NEWLINE)
      document.head.appendChild(style)
      return function () {
        style.remove()
      }
    }

    /** Register the sidebar entry and the main page it opens. */
    function apply(ctx) {
      runtimeContext = ctx
      ctx.effect(installStyles, PACKAGE + ': styles')
      ctx.effect(() => ctx.locale.register(NS, { en, zh }), PACKAGE + ': locale')
      const t = ctx.locale.bind(NS)
      ctx.slots.inject('main', () =>
        ctx.slots.register({ name: 'main', key: PANEL_ID, locale: NS }, PluginCenterPage),
      )
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 1,
            label: () => t('panel'),
            locale: NS,
          },
          MyPluginsIcon,
        ),
      )
    }

    const plugin = {
      inject: ['slots', 'locale'],
      apply,
    }
    if (typeof globalThis !== 'undefined' && globalThis.__ICEX_PLUGIN_CENTER_TEST__ === true) {
      plugin.__test = {
        format,
        shortName,
        statusOf,
        patchConfig,
        PluginCenterPage,
        MyPluginsIcon,
        installStyles,
        STYLE_LINES,
      }
    }
    return plugin
  },
})

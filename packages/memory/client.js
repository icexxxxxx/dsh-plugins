/**
 * icex-dsh-memory client bundle: the settings-page editor for the memory store.
 *
 * The Host half serves GET/POST /api/icex-memory (global or project scope); this
 * module renders the textarea and calls it. No build step: the DSH module loader
 * runs the factory and React comes from the platform module table.
 */
window.__ModuleLoader__.load({
  id: 'icex-dsh-memory',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useEffect = React.useEffect
    const useState = React.useState

    const PACKAGE = 'icex-dsh-memory'
    const NS = 'icex-dsh-memory'

    const en = {
      'settings.title': 'Memory',
      'settings.scope': 'Scope',
      'settings.scope.global': 'Global',
      'settings.scope.project': 'Project',
      'settings.dir.label': 'Working directory',
      'settings.dir.placeholder': '/Users/me/codes/project',
      'settings.dir.hint': 'Absolute path, or start with ~/ . The file is <dir>/.dsh/memory/MEMORY.md.',
      'settings.dir.load': 'Load',
      'settings.loading': 'Loading…',
      'settings.saving': 'Saving…',
      'settings.save': 'Save',
      'settings.reload': 'Reload',
      'settings.placeholder': 'One fact per line: - [pref] … <!-- id=… src=… at=… -->',
      'settings.entries': '{count} entries',
      'settings.path': 'File: {path}',
      'settings.saved': 'Saved. New sessions pick it up at startup.',
      'settings.unsaved': 'Unsaved changes.',
      'settings.error': 'Failed: {message}',
      'settings.hint': 'Entries are injected at the start of the next session. Keep one fact per line, at most 200 characters.',
      'panel.title': 'Memory',
      'panel.description': 'What the model remembers, and what it is still deciding.',
      'panel.stats': '{entries} entries · digest {chars} chars · {candidates} candidates',
      'panel.truncated': 'truncated by the budget',
      'panel.lastConsolidated': 'Last consolidated: {time}',
      'panel.consolidate': 'Consolidate now',
      'panel.candidates': 'Candidates',
      'panel.noCandidates': 'Nothing waiting for review.',
      'panel.modelSays': 'Model suggests: {action} — {reason}',
      'panel.undecided': 'Model has not judged this yet.',
      'panel.promote': 'Keep as memory',
      'panel.dismiss': 'Dismiss',
      'panel.entries': 'Entries',
      'panel.activity': 'Recent activity',
      'panel.verdictPromote': 'keep',
      'panel.verdictDismiss': 'dismiss',
      'panel.refresh': 'Refresh',
      'panel.failed': 'Failed: {message}',
    }

    const zh = {
      'settings.title': '记忆',
      'settings.scope': '作用域',
      'settings.scope.global': '全局',
      'settings.scope.project': '项目',
      'settings.dir.label': '工作目录',
      'settings.dir.hint': '绝对路径，可用 ~/ 开头。文件是 <目录>/.dsh/memory/MEMORY.md。',
      'settings.dir.placeholder': '/Users/me/codes/project',
      'settings.dir.load': '读取',
      'settings.loading': '读取中…',
      'settings.saving': '保存中…',
      'settings.save': '保存',
      'settings.reload': '重新读取',
      'settings.placeholder': '一行一条：- [pref] … <!-- id=… src=… at=… -->',
      'settings.entries': '{count} 条',
      'settings.path': '文件：{path}',
      'settings.saved': '已保存，下个会话开始时生效。',
      'settings.unsaved': '有未保存的修改。',
      'settings.error': '失败：{message}',
      'settings.hint': '记忆会在下一个会话开始时注入。一行一条事实，每条不超过 200 字。',
      'panel.title': '记忆',
      'panel.description': '模型记住了什么，以及它还在判断什么。',
      'panel.stats': '{entries} 条 · 摘要 {chars} 字符 · {candidates} 条候选',
      'panel.truncated': '已被预算截断',
      'panel.lastConsolidated': '上次整理：{time}',
      'panel.consolidate': '立即整理',
      'panel.candidates': '候选',
      'panel.noCandidates': '没有待处理的候选。',
      'panel.modelSays': '模型建议：{action} — {reason}',
      'panel.undecided': '模型还没判断这条。',
      'panel.promote': '转正',
      'panel.dismiss': '丢弃',
      'panel.entries': '已存条目',
      'panel.activity': '最近活动',
      'panel.verdictPromote': '转正',
      'panel.verdictDismiss': '丢弃',
      'panel.refresh': '刷新',
      'panel.failed': '失败：{message}',
    }

    /** Minimal translator with {name} interpolation over the slot's locale texts. */
    function translator(source) {
      const table = source !== null && typeof source === 'object' ? source : en
      return function t(key, values) {
        const template = typeof table[key] === 'string' ? table[key] : key
        if (values === undefined) return template
        return template.replace(/\{(\w+)\}/g, function (match, name) {
          return values[name] === undefined ? match : String(values[name])
        })
      }
    }

    function installStyles() {
      if (typeof document === 'undefined') return function () {}
      const style = document.createElement('style')
      style.dataset.icexMemory = 'true'
      style.textContent = [
        '.icex-memory { display: flex; flex-direction: column; gap: 12px; }',
        '.icex-memory-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }',
        '.icex-memory-tabs { display: inline-flex; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); overflow: hidden; }',
        '.icex-memory-tab { padding: 4px 12px; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; }',
        '.icex-memory-tab[data-active="true"] { background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-on-color); }',
        '.icex-memory-dir { flex: 1 1 240px; min-width: 160px; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-specific-menu); color: var(--dsw-alias-label-primary); font: inherit; }',
        '.icex-memory-text { width: 100%; min-height: 260px; resize: vertical; padding: 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-specific-menu); color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-mono, ui-monospace, monospace); font-size: 12px; line-height: 1.55; white-space: pre; }',
        '.icex-memory-button { padding: 5px 12px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; }',
        '.icex-memory-button[data-primary="true"] { background: var(--dsw-alias-state-business-primary); border-color: transparent; color: var(--dsw-alias-label-on-color); }',
        '.icex-memory-button:disabled { opacity: 0.5; cursor: default; }',
        '.icex-memory-meta { color: var(--dsw-alias-label-secondary); font-size: 12px; }',
        '.icex-memory-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; }',
        '.icex-memory-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; }',
        '.icex-memory h3 { margin: 12px 0 4px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-secondary); }',
        '.icex-memory-candidate { padding: 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); margin-bottom: 8px; }',
        '.icex-memory-kind { color: var(--dsw-alias-label-tertiary); font-size: 11px; margin-right: 6px; }',
        '.icex-memory-verdict { color: var(--dsw-alias-state-business-primary); font-size: 12px; margin: 4px 0; }',
      ].join('\n')
      document.head.appendChild(style)
      return function () {
        style.remove()
      }
    }

    function SettingsPage(props) {
      const t = translator(props.t)
      const [scope, setScope] = useState('global')
      const [dir, setDir] = useState(function () {
        try {
          return window.localStorage.getItem('icex-memory.projectDir') ?? ''
        } catch (error) {
          return ''
        }
      })
      const [text, setText] = useState('')
      const [path, setPath] = useState('')
      const [entries, setEntries] = useState(0)
      const [dirty, setDirty] = useState(false)
      const [busy, setBusy] = useState(false)
      const [message, setMessage] = useState(null)

      function endpoint() {
        const query = '?scope=' + scope + (scope === 'project' ? '&dir=' + encodeURIComponent(dir) : '')
        return '/api/icex-memory' + query
      }

      async function load() {
        if (scope === 'project' && dir.trim() === '') {
          setMessage(null)
          return
        }
        setBusy(true)
        setMessage(null)
        try {
          if (scope === 'project') {
            try {
              window.localStorage.setItem('icex-memory.projectDir', dir.trim())
            } catch (error) {
              // A blocked localStorage only costs the remembered directory.
            }
          }
          const response = await fetch(endpoint(), { credentials: 'same-origin' })
          const body = await response.json()
          if (body.ok !== true) throw new Error(body.error ?? response.status)
          setText(body.text ?? '')
          setPath(body.path ?? '')
          setEntries(body.entries ?? 0)
          setDirty(false)
        } catch (error) {
          setMessage({ kind: 'error', text: t('settings.error', { message: String(error.message ?? error) }) })
        } finally {
          setBusy(false)
        }
      }

      async function save() {
        setBusy(true)
        setMessage(null)
        try {
          const response = await fetch(endpoint(), {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
          })
          const body = await response.json()
          if (body.ok !== true) throw new Error(body.error ?? response.status)
          setEntries(body.entries ?? 0)
          setPath(body.path ?? path)
          setDirty(false)
          setMessage({ kind: 'ok', text: t('settings.saved') })
        } catch (error) {
          setMessage({ kind: 'error', text: t('settings.error', { message: String(error.message ?? error) }) })
        } finally {
          setBusy(false)
        }
      }

      useEffect(() => {
        if (scope === 'global') void load()
      }, [scope])

      if (props.view === 'summary') return null

      return h('section', { className: 'icex-memory', 'aria-label': t('settings.title') },
        h('div', { className: 'icex-memory-row' },
          h('span', { className: 'icex-memory-meta' }, t('settings.scope')),
          h('div', { className: 'icex-memory-tabs' },
            ['global', 'project'].map(function (value) {
              return h('button', {
                key: value,
                type: 'button',
                className: 'icex-memory-tab',
                'data-active': scope === value ? 'true' : 'false',
                onClick: function () {
                  setScope(value)
                  if (value === 'global') void load()
                },
              }, t('settings.scope.' + value))
            }))),
        scope === 'project'
          ? h('div', { className: 'icex-memory-row' },
            h('span', { className: 'icex-memory-meta' }, t('settings.dir.label')),
            h('input', {
              className: 'icex-memory-dir',
              value: dir,
              placeholder: t('settings.dir.placeholder'),
              spellCheck: false,
              onChange: function (event) {
                setDir(event.target.value)
              },
              onKeyDown: function (event) {
                if (event.key === 'Enter' && event.currentTarget.value.trim() !== '') void load()
              },
            }),
            h('button', {
              type: 'button',
              className: 'icex-memory-button',
              disabled: busy || dir.trim() === '',
              onClick: function () {
                void load()
              },
            }, t('settings.dir.load')),
            h('div', { className: 'icex-memory-hint' }, t('settings.dir.hint')))
          : null,
        h('textarea', {
          className: 'icex-memory-text',
          spellCheck: false,
          value: text,
          placeholder: t('settings.placeholder'),
          onChange: function (event) {
            setText(event.target.value)
            setDirty(true)
          },
        }),
        h('div', { className: 'icex-memory-row' },
          h('button', {
            type: 'button',
            className: 'icex-memory-button',
            'data-primary': 'true',
            disabled: busy || !dirty,
            onClick: function () {
              void save()
            },
          }, busy ? t('settings.saving') : t('settings.save')),
          h('button', {
            type: 'button',
            className: 'icex-memory-button',
            disabled: busy,
            onClick: function () {
              void load()
            },
          }, busy ? t('settings.loading') : t('settings.reload')),
          h('span', { className: 'icex-memory-meta' }, t('settings.entries', { count: entries })),
          dirty ? h('span', { className: 'icex-memory-meta' }, t('settings.unsaved')) : null),
        message === null
          ? null
          : h('div', {
            className: message.kind === 'error' ? 'icex-memory-error' : 'icex-memory-meta',
            role: message.kind === 'error' ? 'alert' : 'status',
          }, message.text),
        path === '' ? null : h('div', { className: 'icex-memory-meta' }, t('settings.path', { path })),
        h('div', { className: 'icex-memory-hint' }, t('settings.hint')))
    }

    /** Right-sidebar panel: stats, candidate inbox, entries, and recent activity. */
    function MemoryPanel(props) {
      const t = translator(props.t)
      const dataState = useState(props.initial ?? null)
      const data = dataState[0]
      const errorState = useState(null)
      const error = errorState[0]
      const busyState = useState(false)
      const busy = busyState[0]

      async function load() {
        busyState[1](true)
        errorState[1](null)
        try {
          const response = await fetch('/api/icex-memory/panel', { credentials: 'same-origin' })
          const body = await response.json()
          if (body.ok !== true) throw new Error(body.error ?? String(response.status))
          dataState[1](body)
        } catch (failure) {
          errorState[1](t('panel.failed', { message: String(failure.message ?? failure) }))
        } finally {
          busyState[1](false)
        }
      }

      async function act(payload) {
        busyState[1](true)
        errorState[1](null)
        try {
          const response = await fetch('/api/icex-memory/panel', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
          const body = await response.json()
          if (body.ok !== true) throw new Error(body.error ?? String(response.status))
          await load()
        } catch (failure) {
          busyState[1](false)
          errorState[1](t('panel.failed', { message: String(failure.message ?? failure) }))
        }
      }

      useEffect(function () {
        if (props.initial === undefined) void load()
      }, [])

      if (props.view === 'summary') return null
      if (data === null) return h('div', { className: 'icex-memory', 'data-section': 'loading' }, t('settings.loading'))

      const stats = data.stats ?? {}
      const candidates = Array.isArray(data.candidates) ? data.candidates : []
      const entries = Array.isArray(data.global) ? data.global : []
      const activity = entries.slice().reverse().slice(0, 6)

      return h('div', { className: 'icex-memory' },
        h('section', { className: 'icex-memory-row', 'data-section': 'stats' },
          h('span', { className: 'icex-memory-meta' }, t('panel.stats', {
            entries: (stats.globalEntries ?? 0) + (stats.projectEntries ?? 0),
            chars: stats.digestChars ?? 0,
            candidates: stats.candidates ?? 0,
          })),
          stats.truncated === true ? h('span', { className: 'icex-memory-error' }, t('panel.truncated')) : null,
          h('button', {
            type: 'button',
            className: 'icex-memory-button',
            disabled: busy,
            onClick: function () {
              void act({ action: 'consolidate' })
            },
          }, t('panel.consolidate')),
          h('button', {
            type: 'button',
            className: 'icex-memory-button',
            disabled: busy,
            onClick: function () {
              void load()
            },
          }, t('panel.refresh'))),
        h('div', { className: 'icex-memory-meta' }, stats.lastConsolidatedAt === null || stats.lastConsolidatedAt === undefined
          ? ''
          : t('panel.lastConsolidated', { time: String(stats.lastConsolidatedAt).replace('T', ' ').slice(0, 16) })),
        h('h3', null, t('panel.candidates')),
        h('div', { 'data-section': 'candidates' },
          candidates.length === 0
            ? h('div', { className: 'icex-memory-meta' }, t('panel.noCandidates'))
            : candidates.map(function (candidate) {
              const decision = candidate.decision
              const verdict = decision === null || decision === undefined
                ? t('panel.undecided')
                : t('panel.modelSays', {
                  action: decision.action === 'promote' ? t('panel.verdictPromote') : t('panel.verdictDismiss'),
                  reason: decision.reason === '' ? '—' : decision.reason,
                })
              return h('div', { key: candidate.id, className: 'icex-memory-candidate', 'data-candidate': candidate.id },
                h('div', null, candidate.text),
                h('div', { className: 'icex-memory-meta' }, candidate.src + ' · ' + String(candidate.at ?? '').slice(0, 10)),
                h('div', { className: decision === null || decision === undefined ? 'icex-memory-meta' : 'icex-memory-verdict' }, verdict),
                h('div', { className: 'icex-memory-row' },
                  h('button', {
                    type: 'button',
                    className: 'icex-memory-button',
                    'data-action': 'promote',
                    disabled: busy,
                    onClick: function () {
                      void act({ action: 'promote', id: candidate.id })
                    },
                  }, t('panel.promote')),
                  h('button', {
                    type: 'button',
                    className: 'icex-memory-button',
                    'data-action': 'dismiss',
                    disabled: busy,
                    onClick: function () {
                      void act({ action: 'dismiss', id: candidate.id })
                    },
                  }, t('panel.dismiss'))))
            })),
        h('h3', null, t('panel.entries')),
        h('div', { 'data-section': 'entries' },
          entries.length === 0
            ? h('div', { className: 'icex-memory-meta' }, t('panel.noCandidates'))
            : entries.slice().reverse().map(function (entry) {
              return h('div', { key: entry.id, className: 'icex-memory-row', 'data-entry': entry.id },
                h('span', { className: 'icex-memory-kind' }, '[' + entry.kind + ']'),
                h('span', null, entry.text))
            })),
        h('h3', null, t('panel.activity')),
        h('div', { 'data-section': 'activity' },
          activity.map(function (entry) {
            return h('div', { key: 'a-' + entry.id, className: 'icex-memory-meta' },
              String(entry.at ?? '').slice(0, 10) + ' · [' + entry.kind + '] ' + entry.text.slice(0, 40))
          })),
        error === null ? null : h('div', { className: 'icex-memory-error', role: 'alert' }, error))
    }

    function apply(ctx) {
      const PANEL_ID = PACKAGE + '/panel'
      ctx.effect(installStyles, 'icex-dsh-memory: styles')
      ctx.effect(function () {
        return ctx.locale.register(NS, { en: en, zh: zh })
      }, 'icex-dsh-memory: locale')
      ctx.slots.inject('plugins.bundle.config', function () {
        return ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PACKAGE,
          locale: NS,
        }, SettingsPage)
      })
      ctx.inject(['sidebarRightTabs'], function (scope) {
        scope.effect(function () {
          return scope.sidebarRightTabs.register({
            id: PANEL_ID,
            kind: 'icex-memory-panel',
            title: function () {
              return 'Memory'
            },
            guide: [{
              id: 'open',
              order: 80,
              title: function () {
                return '记忆'
              },
              description: function () {
                return '模型的跨会话记忆与待确认候选'
              },
            }],
          })
        }, 'icex-dsh-memory: sidebar panel type')
        scope.slots.inject('sidebar.right.pane.tab', function () {
          return scope.slots.register({
            name: 'sidebar.right.pane.tab',
            key: PANEL_ID,
            locale: NS,
          }, MemoryPanel)
        })
      })
    }

    return {
      inject: ['slots', 'locale'],
      apply: apply,
    }
  },
})

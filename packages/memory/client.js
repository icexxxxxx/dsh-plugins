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
    }

    const zh = {
      'settings.title': '记忆',
      'settings.scope': '作用域',
      'settings.scope.global': '全局',
      'settings.scope.project': '项目',
      'settings.dir.label': '工作目录',
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
      ].join('\n')
      document.head.appendChild(style)
      return function () {
        style.remove()
      }
    }

    function MemoryPanel(props) {
      const t = translator(props.t)
      const [scope, setScope] = useState('global')
      const [dir, setDir] = useState('')
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
        setBusy(true)
        setMessage(null)
        try {
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
                if (event.key === 'Enter') void load()
              },
            }),
            h('button', {
              type: 'button',
              className: 'icex-memory-button',
              disabled: busy || dir.trim() === '',
              onClick: function () {
                void load()
              },
            }, t('settings.dir.load')))
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

    function apply(ctx) {
      ctx.effect(installStyles, 'icex-dsh-memory: styles')
      ctx.effect(function () {
        return ctx.locale.register(NS, { en: en, zh: zh })
      }, 'icex-dsh-memory: locale')
      ctx.slots.inject('plugins.bundle.config', function () {
        return ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PACKAGE,
          locale: NS,
        }, MemoryPanel)
      })
    }

    return {
      inject: ['slots', 'locale'],
      apply: apply,
    }
  },
})

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
      'panel.subtitle': 'Cross-session memory and pending candidates',
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
      'panel.statEntries': 'entries',
      'panel.statChars': 'digest chars',
      'panel.statCandidates': 'candidates',
      'panel.statConsolidated': 'last consolidated',
      'panel.pending': 'pending',
      'panel.noReason': 'no reason given',
      'panel.noEntries': 'Nothing stored yet.',
      'panel.consolidateShort': 'Tidy',
      'panel.refreshShort': 'Refresh',
      'panel.filterAll': 'All',
      'panel.edit': 'Edit',
      'panel.delete': 'Delete',
      'panel.save': 'Save',
      'panel.cancel': 'Cancel',
      'panel.deleteConfirm': 'Delete this memory entry?',
      'panel.status': '{entries} entries · digest {chars} chars · {candidates} candidates',
      'panel.statusConsolidated': 'tidied {time}',
      'panel.truncatedShort': 'truncated',
      'panel.globalEntries': 'Global memory',
      'panel.projectEntries': 'Project memory',
      'panel.noProjectEntries': 'Nothing stored for this project yet.',
      'panel.noSessionCwd': 'No working directory is known for this session yet.',
      'kind.pref': 'Preference',
      'kind.decision': 'Decision',
      'kind.pitfall': 'Pitfall',
      'kind.tool': 'Tool',
      'kind.project': 'Project',
      'error.unknownAction': 'This action is not available yet. Restart the app to load the new host code.',
      'error.entryNotFound': 'That entry no longer exists.',
      'error.blankText': 'The text cannot be empty.',
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
      'panel.subtitle': '跨会话记忆与待确认候选',
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
      'panel.statEntries': '条目',
      'panel.statChars': '摘要字符',
      'panel.statCandidates': '候选',
      'panel.statConsolidated': '上次整理',
      'panel.pending': '待判',
      'panel.noReason': '未给理由',
      'panel.noEntries': '还没有存任何东西。',
      'panel.consolidateShort': '整理',
      'panel.refreshShort': '刷新',
      'panel.filterAll': '全部',
      'panel.edit': '编辑',
      'panel.delete': '删除',
      'panel.save': '保存',
      'panel.cancel': '取消',
      'panel.deleteConfirm': '删除这条记忆？',
      'panel.status': '{entries} 条 · 摘要 {chars} 字符 · {candidates} 候选',
      'panel.statusConsolidated': '整理于 {time}',
      'panel.truncatedShort': '已截断',
      'panel.globalEntries': '全局记忆',
      'panel.projectEntries': '项目记忆',
      'panel.noProjectEntries': '这个项目还没有记忆。',
      'panel.noSessionCwd': '还拿不到当前会话的工作目录。',
      'kind.pref': '偏好',
      'kind.decision': '决定',
      'kind.pitfall': '坑',
      'kind.tool': '工具',
      'kind.project': '项目',
      'error.unknownAction': '这个操作还不可用：重启 App 加载新的 host 代码。',
      'error.entryNotFound': '这条记忆已经不在了。',
      'error.blankText': '内容不能为空。',
    }

    /** Minimal translator with {name} interpolation over the slot's locale texts. */
    function translator(source) {
      if (typeof source === 'function') return source
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
        '.icex-mem { box-sizing: border-box; display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); font-size: 13px; line-height: 20px; }',
        '.icex-mem-top { flex: none; display: flex; flex-direction: column; gap: 8px; padding: 12px 16px 8px; }',
        '.icex-mem-head { display: flex; align-items: center; gap: 8px; }',
        '.icex-mem-title { margin: 0; font-size: 13px; font-weight: 500; line-height: 20px; }',
        '.icex-mem-count { color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }',
        '.icex-mem-spacer { flex: 1; }',
        '.icex-mem-text-btn { height: 20px; padding: 0 4px; border: 0; border-radius: var(--dsw-radius-sm, 4px); background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; cursor: pointer; }',
        '.icex-mem-text-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }',
        '.icex-mem-text-btn:disabled { opacity: 0.5; cursor: default; }',
        '.icex-mem-filters { display: flex; flex-wrap: wrap; gap: 6px; }',
        '.icex-mem-filter { display: inline-flex; align-items: center; gap: 4px; height: 22px; padding: 0 8px; border: 1px solid transparent; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 12%, transparent); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 11px; line-height: 1; cursor: pointer; }',
        '.icex-mem-filter:hover { background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent); }',
        '.icex-mem-filter[data-active="true"] { border-color: var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }',
        '.icex-mem-filter-count { color: var(--dsw-alias-label-tertiary); font-size: 10px; }',
        '.icex-mem-filter[data-kind="pref"] { color: var(--dsw-alias-state-business-primary); background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 12%, transparent); }',
        '.icex-mem-filter[data-kind="decision"] { color: #a78bfa; background: color-mix(in srgb, #a78bfa 14%, transparent); }',
        '.icex-mem-filter[data-kind="pitfall"] { color: var(--dsw-alias-state-error-primary); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); }',
        '.icex-mem-filter[data-kind="tool"] { color: #34d399; background: color-mix(in srgb, #34d399 14%, transparent); }',
        '.icex-mem-filter[data-kind="project"] { color: #fbbf24; background: color-mix(in srgb, #fbbf24 14%, transparent); }',
        '.icex-mem-body { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 16px; padding: 4px 16px 16px; }',
        '.icex-mem-section { display: flex; flex-direction: column; gap: 8px; }',
        '.icex-mem-section-head { display: flex; align-items: center; gap: 8px; }',
        '.icex-mem-section-title { margin: 0; font-size: 12px; font-weight: 500; line-height: 18px; color: var(--dsw-alias-label-secondary); }',
        '.icex-mem-btn { height: 24px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; cursor: pointer; }',
        '.icex-mem-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); }',
        '.icex-mem-btn:disabled { opacity: 0.5; cursor: default; }',
        '.icex-mem-btn-primary { background: var(--dsw-alias-state-business-primary); border-color: transparent; color: var(--dsw-alias-label-on-color); }',
        '.icex-mem-btn-quiet { border-color: transparent; color: var(--dsw-alias-label-secondary); }',
        '.icex-mem-cards { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }',
        '.icex-mem-card { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); }',
        '.icex-mem-card-text { margin: 0; font-size: 13px; line-height: 19px; overflow-wrap: anywhere; }',
        '.icex-mem-meta { display: flex; gap: 8px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }',
        '.icex-mem-src { max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
        '.icex-mem-verdict { display: flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; }',
        '.icex-mem-pill { flex: none; display: inline-flex; align-items: center; height: 18px; padding: 0 7px; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 20%, transparent); color: var(--dsw-alias-label-secondary); font-size: 10px; line-height: 1; }',
        '.icex-mem-pill[data-tone="promote"] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent); color: var(--dsw-alias-state-business-primary); }',
        '.icex-mem-pill[data-tone="dismiss"] { background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 18%, transparent); color: var(--dsw-alias-label-secondary); }',
        '.icex-mem-reason { overflow-wrap: anywhere; }',
        '.icex-mem-actions { display: flex; gap: 8px; }',
        '.icex-mem-list { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }',
        '.icex-mem-row { position: relative; display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 6px 10px; margin: 0 -10px; border-radius: var(--dsw-radius-md); }',
        '.icex-mem-row:hover { background: var(--dsw-alias-bg-layer-1); }',
        '.icex-mem-row + .icex-mem-row { border-top: 0.5px solid var(--dsw-alias-border-l1); }',
        '.icex-mem-row-edit { display: flex; flex-direction: column; align-items: stretch; gap: 6px; }',
        '.icex-mem-row-edit .icex-mem-actions { justify-content: flex-end; }',
        '.icex-mem-kind { box-sizing: border-box; width: 100%; height: 18px; padding: 0 4px; border-radius: 6px; font-size: 10px; line-height: 18px; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; background: color-mix(in srgb, var(--dsw-alias-label-tertiary) 16%, transparent); color: var(--dsw-alias-label-secondary); }',
        '.icex-mem-kind[data-kind="pref"] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent); color: var(--dsw-alias-state-business-primary); }',
        '.icex-mem-kind[data-kind="decision"] { background: color-mix(in srgb, #a78bfa 18%, transparent); color: #a78bfa; }',
        '.icex-mem-kind[data-kind="pitfall"] { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent); color: var(--dsw-alias-state-error-primary); }',
        '.icex-mem-kind[data-kind="tool"] { background: color-mix(in srgb, #34d399 18%, transparent); color: #34d399; }',
        '.icex-mem-kind[data-kind="project"] { background: color-mix(in srgb, #fbbf24 18%, transparent); color: #fbbf24; }',
        '.icex-mem-row-text { min-width: 0; overflow-wrap: anywhere; }',
        '.icex-mem-row-date { flex: none; color: var(--dsw-alias-label-tertiary); font-size: 11px; }',
        '.icex-mem-row-actions { position: absolute; top: 0; bottom: 0; right: 0; display: flex; align-items: stretch; gap: 2px; padding: 0 6px 0 24px; border-radius: 0 var(--dsw-radius-md) var(--dsw-radius-md) 0; background: linear-gradient(to right, transparent, var(--dsw-alias-bg-layer-1) 30%); opacity: 0; pointer-events: none; transition: opacity 120ms ease; }',
        '.icex-mem-row:hover .icex-mem-row-actions, .icex-mem-row:focus-within .icex-mem-row-actions { opacity: 1; pointer-events: auto; }',
        '.icex-mem-icon-btn { display: inline-flex; align-items: center; height: 100%; padding: 0 6px; border: 0; border-radius: var(--dsw-radius-sm, 4px); background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 11px; cursor: pointer; }',
        '.icex-mem-icon-btn:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,0.14)); color: var(--dsw-alias-label-primary); }',
        '.icex-mem-icon-btn[data-action="delete"]:hover:not(:disabled) { color: var(--dsw-alias-state-error-primary); }',
        '.icex-mem-edit { display: block; width: 100%; min-height: 64px; box-sizing: border-box; resize: vertical; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-md); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 12px; line-height: 18px; }',
        '.icex-mem-timeline { display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 0; list-style: none; }',
        '.icex-mem-event { display: grid; grid-template-columns: 8px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; font-size: 12px; line-height: 18px; }',
        '.icex-mem-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--dsw-alias-state-business-primary); align-self: center; }',
        '.icex-mem-dot[data-kind="pitfall"] { background: var(--dsw-alias-state-error-primary); }',
        '.icex-mem-dot[data-kind="decision"] { background: #a78bfa; }',
        '.icex-mem-dot[data-kind="tool"] { background: #34d399; }',
        '.icex-mem-event-text { color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }',
        '.icex-mem-event-date { color: var(--dsw-alias-label-tertiary); font-size: 11px; }',
        '.icex-mem-empty { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }',
        '.icex-mem-banner { margin: 8px 0 0; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent); color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }',
        '.icex-mem-path { margin: -2px 0 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }',
        '.icex-mem-status { flex: none; display: flex; align-items: center; gap: 8px; padding: 6px 16px; border-top: 0.5px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-tertiary); font-size: 11px; line-height: 16px; }',
        '.icex-mem-status-warn { color: var(--dsw-alias-label-secondary); }',
        '.icex-mem-status-error { color: var(--dsw-alias-state-error-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 50%; }',
        '.icex-mem-loading { padding: 24px 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; text-align: center; }',
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

    /** Right-sidebar panel: filters, candidate inbox, editable entries, and a compact status bar. */
    function MemoryPanel(props) {
      const t = translator(props.t)
      const dataState = useState(props.initial ?? null)
      const data = dataState[0]
      const errorState = useState(null)
      const error = errorState[0]
      const busyState = useState(false)
      const busy = busyState[0]
      const filterState = useState('all')
      const filter = filterState[0]
      const editState = useState(null)
      const editing = editState[0]

      async function load() {
        busyState[1](true)
        errorState[1](null)
        try {
          const query = props.sessionId === undefined ? '' : '?session=' + encodeURIComponent(props.sessionId)
          const response = await fetch('/api/icex-memory/panel' + query, { credentials: 'same-origin' })
          const body = await response.json()
          if (body.ok !== true) throw new Error(body.error ?? String(response.status))
          dataState[1](body)
        } catch (failure) {
          errorState[1](t('panel.failed', { message: explain(failure.message) }))
        } finally {
          busyState[1](false)
        }
      }

      function explain(message) {
        const text = String(message ?? '')
        if (text.includes('unknown action')) return t('error.unknownAction')
        if (text.includes('entry not found')) return t('error.entryNotFound')
        return text
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
          return true
        } catch (failure) {
          busyState[1](false)
          errorState[1](t('panel.failed', { message: explain(failure.message) }))
          return false
        }
      }

      useEffect(function () {
        if (props.initial === undefined) void load()
      }, [])

      if (props.view === 'summary') return null
      if (data === null) {
        return h('div', { className: 'icex-mem' },
          h('div', { className: 'icex-mem-loading', 'data-section': 'loading' }, t('settings.loading')))
      }

      const stats = data.stats ?? {}
      const candidates = Array.isArray(data.candidates) ? data.candidates : []
      const globalEntries = Array.isArray(data.global) ? data.global : []
      const projectEntries = Array.isArray(data.project?.entries) ? data.project.entries : []
      const entries = globalEntries
      const allEntries = globalEntries.concat(projectEntries)
      const kinds = ['all'].concat(Array.from(new Set(allEntries.map((entry) => entry.kind))))
      const matches = function (entry) { return filter === 'all' || entry.kind === filter }
      const visibleGlobal = globalEntries.filter(matches)
      const visibleProject = projectEntries.filter(matches)
      const activity = allEntries.slice(-4).reverse()
      const total = (stats.globalEntries ?? 0) + (stats.projectEntries ?? 0)

      const KIND_LABELS = { pref: t('kind.pref'), decision: t('kind.decision'), pitfall: t('kind.pitfall'), tool: t('kind.tool'), project: t('kind.project') }
      const kindLabel = function (kind) { return KIND_LABELS[kind] ?? kind }
      function chip(label, value, count) {
        return h('button', {
          key: value,
          type: 'button',
          className: 'icex-mem-filter',
          'data-active': filter === value ? 'true' : 'false',
          'data-kind': value === 'all' ? undefined : value,
          onClick: function () { filterState[1](value) },
        }, label, count === undefined ? null : h('span', { className: 'icex-mem-filter-count' }, String(count)))
      }

      function entryRow(entry) {
        if (editing !== null && editing.id === entry.id) {
          return h('li', { key: entry.id, className: 'icex-mem-row icex-mem-row-edit', 'data-entry': entry.id },
            h('textarea', {
              className: 'icex-mem-edit',
              value: editing.text,
              rows: 2,
              onChange: function (event) { editState[1]({ id: entry.id, text: event.target.value }) },
            }),
            h('div', { className: 'icex-mem-actions' },
              h('button', {
                type: 'button',
                className: 'icex-mem-btn icex-mem-btn-primary',
                disabled: busy,
                onClick: function () {
                  const text = editing.text.trim()
                  if (text === '') return
                  void act({ action: 'update', id: entry.id, text: text, scope: entry.scope }).then(function (ok) {
                    if (ok) editState[1](null)
                  })
                },
              }, t('panel.save')),
              h('button', {
                type: 'button',
                className: 'icex-mem-btn icex-mem-btn-quiet',
                disabled: busy,
                onClick: function () { editState[1](null) },
              }, t('panel.cancel'))))
        }
        return h('li', { key: entry.id, className: 'icex-mem-row', 'data-entry': entry.id },
          h('span', { className: 'icex-mem-kind', 'data-kind': entry.kind }, kindLabel(entry.kind)),
          h('span', { className: 'icex-mem-row-text' }, entry.text),
          h('span', { className: 'icex-mem-row-date' }, String(entry.at ?? '').slice(5)),
          h('span', { className: 'icex-mem-row-actions' },
            h('button', {
              type: 'button',
              className: 'icex-mem-icon-btn',
              title: t('panel.edit'),
              'data-action': 'edit',
              disabled: busy,
              onClick: function () { editState[1]({ id: entry.id, text: entry.text }) },
            }, t('panel.edit')),
            h('button', {
              type: 'button',
              className: 'icex-mem-icon-btn',
              title: t('panel.delete'),
              'data-action': 'delete',
              disabled: busy,
              onClick: function () {
                if (typeof window === 'undefined' || window.confirm(t('panel.deleteConfirm')) !== true) return
                void act({ action: 'delete', id: entry.id, scope: entry.scope })
              },
            }, t('panel.delete'))))
      }

      return h('div', { className: 'icex-mem' },
        h('div', { className: 'icex-mem-top' },
          h('div', { className: 'icex-mem-head', 'data-section': 'header' },
            h('h2', { className: 'icex-mem-title' }, t('panel.title')),
            h('span', { className: 'icex-mem-count' }, String(total)),
            h('span', { className: 'icex-mem-spacer' }),
            h('button', {
              type: 'button',
              className: 'icex-mem-text-btn',
              disabled: busy,
              onClick: function () { void act({ action: 'consolidate' }) },
            }, t('panel.consolidateShort')),
            h('button', {
              type: 'button',
              className: 'icex-mem-text-btn',
              disabled: busy,
              onClick: function () { void load() },
            }, t('panel.refreshShort'))),
          h('div', { className: 'icex-mem-filters', 'data-section': 'filters' },
            kinds.map(function (kind) {
              return chip(kind === 'all' ? t('panel.filterAll') : kindLabel(kind), kind, kind === 'all' ? allEntries.length : allEntries.filter((entry) => entry.kind === kind).length)
            }))),

        h('div', { className: 'icex-mem-body', 'data-section': 'body' },
          error === null ? null : h('p', { className: 'icex-mem-banner', role: 'alert' }, error),
          h('section', { className: 'icex-mem-section', 'data-section': 'candidates' },
            h('div', { className: 'icex-mem-section-head' },
              h('h3', { className: 'icex-mem-section-title' }, t('panel.candidates')),
              h('span', { className: 'icex-mem-count' }, String(candidates.length))),
            candidates.length === 0
              ? h('p', { className: 'icex-mem-empty' }, t('panel.noCandidates'))
              : h('ul', { className: 'icex-mem-cards' }, candidates.map(function (candidate) {
                const decision = candidate.decision
                return h('li', { key: candidate.id, className: 'icex-mem-card', 'data-candidate': candidate.id },
                  h('p', { className: 'icex-mem-card-text' }, candidate.text),
                  h('div', { className: 'icex-mem-meta' },
                    h('span', { className: 'icex-mem-src', title: candidate.src }, candidate.src),
                    h('span', null, String(candidate.at ?? '').slice(0, 10))),
                  decision === null || decision === undefined
                    ? h('div', { className: 'icex-mem-verdict' }, h('span', { className: 'icex-mem-pill' }, t('panel.pending')), t('panel.undecided'))
                    : h('div', { className: 'icex-mem-verdict' },
                      h('span', { className: 'icex-mem-pill', 'data-tone': decision.action }, decision.action === 'promote' ? t('panel.verdictPromote') : t('panel.verdictDismiss')),
                      h('span', { className: 'icex-mem-reason' }, decision.reason === '' ? t('panel.noReason') : decision.reason)),
                  h('div', { className: 'icex-mem-actions' },
                    h('button', {
                      type: 'button',
                      className: 'icex-mem-btn icex-mem-btn-primary',
                      'data-action': 'promote',
                      disabled: busy,
                      onClick: function () { void act({ action: 'promote', id: candidate.id }) },
                    }, t('panel.promote')),
                    h('button', {
                      type: 'button',
                      className: 'icex-mem-btn icex-mem-btn-quiet',
                      'data-action': 'dismiss',
                      disabled: busy,
                      onClick: function () { void act({ action: 'dismiss', id: candidate.id }) },
                    }, t('panel.dismiss'))))
              }))),
          data.project !== undefined && data.project.path !== null && data.project.path !== undefined
            ? h('section', { className: 'icex-mem-section', 'data-section': 'project' },
              h('div', { className: 'icex-mem-section-head' },
                h('h3', { className: 'icex-mem-section-title' }, t('panel.projectEntries')),
                h('span', { className: 'icex-mem-count' }, String(visibleProject.length))),
              h('p', { className: 'icex-mem-path', title: data.project.path }, data.project.path),
              visibleProject.length === 0
                ? h('p', { className: 'icex-mem-empty' }, t('panel.noProjectEntries'))
                : h('ul', { className: 'icex-mem-list' }, visibleProject.slice().reverse().map(entryRow)))
            : h('section', { className: 'icex-mem-section', 'data-section': 'project-missing' },
              h('h3', { className: 'icex-mem-section-title' }, t('panel.projectEntries')),
              h('p', { className: 'icex-mem-empty' }, t('panel.noSessionCwd'))),
          h('section', { className: 'icex-mem-section', 'data-section': 'entries' },
            h('div', { className: 'icex-mem-section-head' },
              h('h3', { className: 'icex-mem-section-title' }, t('panel.globalEntries')),
              h('span', { className: 'icex-mem-count' }, String(visibleGlobal.length))),
            visibleGlobal.length === 0
              ? h('p', { className: 'icex-mem-empty' }, t('panel.noEntries'))
              : h('ul', { className: 'icex-mem-list' }, visibleGlobal.slice().reverse().map(entryRow))),
          h('section', { className: 'icex-mem-section', 'data-section': 'activity' },
            h('div', { className: 'icex-mem-section-head' },
              h('h3', { className: 'icex-mem-section-title' }, t('panel.activity')),
              h('span', { className: 'icex-mem-count' }, String(activity.length))),
            h('ol', { className: 'icex-mem-timeline' }, activity.map(function (entry) {
              return h('li', { key: 'a-' + entry.id, className: 'icex-mem-event' },
                h('span', { className: 'icex-mem-dot', 'data-kind': entry.kind }),
                h('span', { className: 'icex-mem-event-text' }, entry.text),
                h('span', { className: 'icex-mem-event-date' }, String(entry.at ?? '').slice(5)))
            })))),

        h('footer', { className: 'icex-mem-status', 'data-section': 'status' },
          h('span', null, t('panel.status', {
            entries: total,
            chars: stats.digestChars ?? 0,
            candidates: stats.candidates ?? 0,
          })),
          h('span', { className: 'icex-mem-spacer' }),
          h('span', null, stats.lastConsolidatedAt === null || stats.lastConsolidatedAt === undefined
            ? ''
            : t('panel.statusConsolidated', { time: String(stats.lastConsolidatedAt).replace('T', ' ').slice(5, 16) })),
          stats.truncated === true ? h('span', { className: 'icex-mem-status-warn' }, t('panel.truncatedShort')) : null,
          error === null ? null : h('span', { className: 'icex-mem-status-error', role: 'alert' }, error)))
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
      const bound = typeof ctx.locale?.bind === 'function' ? ctx.locale.bind(NS) : function (key) { return key }
      const label = function (key) {
        try {
          const value = bound(key)
          return typeof value === 'string' ? value : key
        } catch (error) {
          return key
        }
      }
      ctx.inject(['sidebarRightTabs'], function (scope) {
        scope.effect(function () {
          return scope.sidebarRightTabs.register({
            id: PANEL_ID,
            kind: 'icex-memory-panel',
            title: function () {
              return label('panel.title')
            },
            guide: [{
              id: 'open',
              order: 80,
              title: function () {
                return label('panel.title')
              },
              description: function () {
                return label('panel.subtitle')
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

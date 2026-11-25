/**
 * icex-dsh-fixer client bundle.
 *
 * Browser-side features over the shipped DSH web client:
 * 1. A left-side dot rail anchored on each user turn; hover (1 s by default)
 *    reveals the input, click pages history in when needed and scrolls to it.
 * 2. A settings page for the rail, the native window summon helper, and bare
 *    mode (turn every other plugin off and back on).
 *
 * Hand-written in the module-loader factory format, so it needs no build step.
 * Only react and react-dom are read from the platform module table.
 */
window.__ModuleLoader__.load({
  id: 'icex-dsh-fixer',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const h = React.createElement
    const Fragment = React.Fragment
    const useCallback = React.useCallback
    const useEffect = React.useEffect
    const useLayoutEffect = React.useLayoutEffect
    const useMemo = React.useMemo
    const useRef = React.useRef
    const useState = React.useState
    const useSyncExternalStore = React.useSyncExternalStore
    const createPortal = ReactDOM.createPortal

    const PACKAGE = 'icex-dsh-fixer'
    const NS = 'icex-dsh-fixer'
    const SETTINGS_KEY = 'icex-dsh-fixer.settings.v1'
    const BARE_KEY = 'icex-dsh-fixer.bare.v1'
    const MIN_DELAY = 200
    const MAX_DELAY = 3000
    const RAIL_GAP = 34
    const NEWLINE = String.fromCharCode(10)

    /** Captured in apply for Session history paging from the rail. */
    let runtimeContext = null

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value))
    }

    function integer(value, min, max, fallback) {
      const number = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(number)) return fallback
      return clamp(Math.round(number), min, max)
    }

    function browserStorage() {
      try {
        return typeof localStorage === 'undefined' ? null : localStorage
      } catch (error) {
        return null
      }
    }

    const DEFAULT_SETTINGS = Object.freeze({
      anchorsEnabled: true,
      tooltipDelayMs: 1000,
      hideNativeRail: true,
    })

    function normalizeSettings(raw) {
      const value = raw !== null && typeof raw === 'object' ? raw : {}
      return Object.freeze({
        anchorsEnabled: value.anchorsEnabled !== false,
        tooltipDelayMs: integer(value.tooltipDelayMs, MIN_DELAY, MAX_DELAY, 1000),
        hideNativeRail: value.hideNativeRail !== false,
      })
    }

    function readSettings() {
      const storage = browserStorage()
      if (storage === null) return DEFAULT_SETTINGS
      try {
        const raw = storage.getItem(SETTINGS_KEY)
        return raw === null ? DEFAULT_SETTINGS : normalizeSettings(JSON.parse(raw))
      } catch (error) {
        return DEFAULT_SETTINGS
      }
    }

    function sameSettings(left, right) {
      return left.anchorsEnabled === right.anchorsEnabled
        && left.tooltipDelayMs === right.tooltipDelayMs
        && left.hideNativeRail === right.hideNativeRail
    }

    function createSettingsStore() {
      let state = readSettings()
      const listeners = new Set()
      return {
        get() {
          return state
        },
        subscribe(listener) {
          listeners.add(listener)
          return function () {
            listeners.delete(listener)
          }
        },
        update(patch) {
          const next = normalizeSettings(Object.assign({}, state, patch))
          if (sameSettings(state, next)) return
          state = next
          const storage = browserStorage()
          if (storage !== null) {
            try {
              storage.setItem(SETTINGS_KEY, JSON.stringify(state))
            } catch (error) {
              // Private mode or a full quota keeps the in-memory value.
            }
          }
          listeners.forEach(function (listener) {
            try {
              listener()
            } catch (error) {
              console.error('[icex-dsh-fixer] settings listener failed', error)
            }
          })
        },
      }
    }

    const settingsStore = createSettingsStore()

    function useSettings() {
      return useSyncExternalStore(settingsStore.subscribe, settingsStore.get)
    }

    /** Mirrored in this browser so the first paint already hides bare-mode additions. */
    const DEFAULT_BARE = Object.freeze({ active: false, count: 0 })

    function normalizeBare(raw) {
      const value = raw !== null && typeof raw === 'object' ? raw : {}
      return Object.freeze({
        active: value.active === true,
        count: integer(value.count, 0, 999, 0),
      })
    }

    function readBare() {
      const storage = browserStorage()
      if (storage === null) return DEFAULT_BARE
      try {
        const raw = storage.getItem(BARE_KEY)
        return raw === null ? DEFAULT_BARE : normalizeBare(JSON.parse(raw))
      } catch (error) {
        return DEFAULT_BARE
      }
    }

    function sameBare(left, right) {
      return left.active === right.active && left.count === right.count
    }

    function createBareStore() {
      let state = readBare()
      const listeners = new Set()
      return {
        get() {
          return state
        },
        subscribe(listener) {
          listeners.add(listener)
          return function () {
            listeners.delete(listener)
          }
        },
        update(patch) {
          const next = normalizeBare(Object.assign({}, state, patch))
          if (sameBare(state, next)) return
          state = next
          const storage = browserStorage()
          if (storage !== null) {
            try {
              storage.setItem(BARE_KEY, JSON.stringify(state))
            } catch (error) {
              // Private mode or a full quota keeps the in-memory value.
            }
          }
          listeners.forEach(function (listener) {
            try {
              listener()
            } catch (error) {
              console.error('[icex-dsh-fixer] bare-mode listener failed', error)
            }
          })
        },
      }
    }

    const bareStore = createBareStore()

    function useBare() {
      return useSyncExternalStore(bareStore.subscribe, bareStore.get)
    }

    function flatten(text) {
      if (typeof text !== 'string') return ''
      return text.split(NEWLINE).join(' ').split('\t').join(' ').split(' ').filter(Boolean).join(' ').trim()
    }

    function clip(text, max) {
      if (text.length <= max) return text
      return text.slice(0, Math.max(0, max - 1)) + '…'
    }

    function outlineEntries(outline) {
      if (!Array.isArray(outline)) return []
      const entries = []
      outline.forEach(function (raw) {
        if (raw === null || typeof raw !== 'object') return
        const turn = raw.turn
        const seq = raw.seq
        if (!Number.isSafeInteger(turn) || turn < 0) return
        if (!Number.isSafeInteger(seq) || seq < 0) return
        entries.push({
          turn: turn,
          seq: seq,
          prompt: typeof raw.prompt === 'string' ? raw.prompt : '',
          anchorKey: null,
        })
      })
      return entries
    }

    function mergeAnchors(outline, loaded) {
      const byTurn = new Map()
      outlineEntries(outline).forEach(function (entry) {
        byTurn.set(entry.turn, entry)
      })
      if (Array.isArray(loaded)) {
        loaded.forEach(function (item) {
          if (item === null || typeof item !== 'object') return
          if (!Number.isSafeInteger(item.turn) || item.turn < 0) return
          const previous = byTurn.get(item.turn)
          byTurn.set(item.turn, {
            turn: item.turn,
            seq: previous === undefined ? null : previous.seq,
            prompt: typeof item.prompt === 'string' && item.prompt !== ''
              ? item.prompt
              : previous === undefined ? '' : previous.prompt,
            anchorKey: typeof item.anchorKey === 'string' ? item.anchorKey : null,
          })
        })
      }
      return Array.from(byTurn.values()).sort(function (left, right) {
        return left.turn - right.turn
      })
    }

    function findUserRow(scroller, turn) {
      const rows = scroller.querySelectorAll('[data-chat-flow-kind="user"][data-chat-turn]')
      for (let index = 0; index < rows.length; index += 1) {
        if (rows[index].getAttribute('data-chat-turn') === String(turn)) return rows[index]
      }
      return null
    }

    function findAnchor(scroller, anchor) {
      const row = findUserRow(scroller, anchor.turn)
      if (row !== null) return row
      if (anchor.anchorKey !== null) {
        const keyed = scroller.querySelectorAll('[data-chat-anchor-key]')
        for (let index = 0; index < keyed.length; index += 1) {
          if (keyed[index].getAttribute('data-chat-anchor-key') === anchor.anchorKey) return keyed[index]
        }
      }
      return null
    }

    function findTurnAtOrAfter(scroller, turn) {
      const rows = scroller.querySelectorAll('[data-chat-turn]')
      for (let index = 0; index < rows.length; index += 1) {
        const value = Number(rows[index].getAttribute('data-chat-turn'))
        if (!Number.isSafeInteger(value) || value < turn) continue
        if (rows[index].getBoundingClientRect().height > 0) return rows[index]
      }
      return null
    }

    function waitForAnchor(scroller, anchor, timeoutMs) {
      return new Promise(function (resolve) {
        const started = performance.now()
        function tick() {
          const row = findAnchor(scroller, anchor) || findTurnAtOrAfter(scroller, anchor.turn)
          if (row !== null) {
            resolve(row)
            return
          }
          if (performance.now() - started >= timeoutMs) {
            resolve(null)
            return
          }
          requestAnimationFrame(tick)
        }
        tick()
      })
    }

    function translator(t) {
      return typeof t === 'function' ? t : function (key) {
        return key
      }
    }

    function SettingRow(props) {
      return h('div', {
        className: props.switchRow === true ? 'icex-fixer-row icex-fixer-switchRow' : 'icex-fixer-row',
      },
        h('div', { className: 'icex-fixer-copy' },
          h('div', { className: 'icex-fixer-title' }, props.title),
          props.description === undefined || props.description === null
            ? null
            : h('div', { className: 'icex-fixer-desc' }, props.description)),
        h('div', { className: 'icex-fixer-control' }, props.children))
    }

    function Toggle(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        className: 'icex-fixer-switch',
        'aria-checked': props.checked,
        'aria-label': props.label,
        disabled: props.disabled === true,
        onClick: function () {
          if (props.disabled === true) return
          props.onChange(!props.checked)
        },
      }, h('span', { className: 'icex-fixer-knob', 'aria-hidden': true }))
    }

    /** One JSON reply from the bare-mode route, with the Host's refusals as errors. */
    function bareReply(response) {
      return response.json().catch(function () {
        return null
      }).then(function (body) {
        if (body !== null && typeof body === 'object' && body.ok === true) return body
        if (body !== null && typeof body === 'object' && typeof body.error === 'string') throw new Error(body.error)
        if (response.status === 401) throw new Error('unauthorized')
        throw new Error('HTTP ' + String(response.status))
      })
    }

    /** Turn a Host refusal or a transport failure into one actionable line. */
    function bareErrorMessage(error, t) {
      const message = String(error?.message ?? error)
      if (message === 'plugin manager is unavailable') return t('bare.noManager')
      if (message === 'another change is in progress') return t('bare.busyError')
      if (message === 'unauthorized') return t('bare.unauthorized')
      if (error instanceof TypeError) return t('bare.offline')
      return t('bare.failed', { message: message })
    }

    function bareStatusRequest() {
      return fetch('/api/icex-fixer/bare-mode', {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      }).then(bareReply)
    }

    function bareSwitchRequest(action) {
      return fetch('/api/icex-fixer/bare-mode', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: action }),
      }).then(bareReply)
    }

    /** Apply a Host reply to the mirror so the rest of the page hides or returns. */
    function syncBareFromReply(body) {
      const count = Array.isArray(body.disabled)
        ? body.disabled.length
        : Array.isArray(body.snapshot?.bundles) ? body.snapshot.bundles.length : 0
      bareStore.update({ active: body.active === true, count: body.active === true ? count : 0 })
      return body
    }

    /**
     * The bare-mode switch: turn every plugin off, then all back on. The Host
     * keeps the snapshot, so this page only reports and reloads.
     */
    function BareModeSection(props) {
      const t = translator(props.t)
      const bare = useBare()
      const busyState = useState(false)
      const noteState = useState(null)
      const candidatesState = useState(null)
      const busy = busyState[0]
      const setBusy = busyState[1]
      const note = noteState[0]
      const setNote = noteState[1]
      const candidates = candidatesState[0]
      const setCandidates = candidatesState[1]

      useEffect(function () {
        let live = true
        bareStatusRequest().then(function (body) {
          if (!live) return
          syncBareFromReply(body)
          if (Number.isInteger(body.candidates)) setCandidates(body.candidates)
        }).catch(function () {
          // A missing route means this Host half predates the feature; the
          // switch then reports the failure itself.
        })
        return function () {
          live = false
        }
      }, [])

      function toggle() {
        if (busy) return
        const next = bare.active !== true
        if (next) {
          const question = Number.isInteger(candidates)
            ? t('bare.confirmCount', { count: candidates })
            : t('bare.confirm')
          if (typeof window !== 'undefined' && window.confirm(question) !== true) return
        }
        setBusy(true)
        setNote(null)
        bareSwitchRequest(next ? 'on' : 'off').then(function (body) {
          const result = syncBareFromReply(body)
          if (Number.isInteger(result.candidates)) setCandidates(result.candidates)
          const failed = Array.isArray(result.failed) ? result.failed : []
          if (failed.length > 0) {
            setBusy(false)
            setNote(t(next ? 'bare.partial' : 'bare.partialOff', { names: failed.map(function (item) { return item.name }).join(', ') }))
            return
          }
          if (next === true && result.active !== true) {
            setBusy(false)
            setNote(t('bare.empty'))
            return
          }
          const restart = Array.isArray(result.restartRequired) ? result.restartRequired : []
          if (restart.length > 0 && typeof window !== 'undefined') {
            window.alert(t('bare.restart', { names: restart.join(', ') }))
          }
          if (typeof window !== 'undefined') window.location.reload()
        }).catch(function (error) {
          setBusy(false)
          setNote(bareErrorMessage(error, t))
        })
      }

      return h(Fragment, null,
        h(SettingRow, {
          title: t('bare.title'),
          description: t('bare.desc'),
          switchRow: true,
        },
          h('div', { className: 'icex-fixer-bareControl' },
            h(Toggle, {
              checked: bare.active,
              label: t('bare.title'),
              disabled: busy,
              onChange: toggle,
            }),
            h('div', { className: 'icex-fixer-value' },
              busy
                ? t('bare.busy')
                : bare.active ? t('bare.on', { count: bare.count }) : t('bare.off')))),
        bare.active === true
          ? h('div', { className: 'icex-fixer-hint icex-fixer-bareHint' }, t('bare.keepAlive'))
          : null,
        note === null
          ? null
          : h('div', { className: 'icex-fixer-errorBlock', role: 'alert' }, note))
    }

    function SettingsPage(props) {
      const t = translator(props.t)
      const settings = useSettings()
      const bare = useBare()
      if (props.view === 'summary') return null

      return h('section', { className: 'icex-fixer-settings', 'aria-label': t('settings.title') },
        h('div', { className: 'icex-fixer-heading' }, t('settings.title')),
        h('div', { className: 'icex-fixer-card' },
          h(SettingRow, {
            title: t('settings.anchors.title'),
            description: t('settings.anchors.desc'),
            switchRow: true,
          },
            h(Toggle, {
              checked: settings.anchorsEnabled,
              label: t('settings.anchors.enable'),
              disabled: bare.active,
              onChange: function (checked) {
                settingsStore.update({ anchorsEnabled: checked })
              },
            })),
          h(SettingRow, {
            title: t('settings.anchors.delay'),
            description: t('settings.anchors.delayDesc'),
          },
            h('div', { className: 'icex-fixer-width' },
              h('div', { className: 'icex-fixer-widthHead' },
                h('span', { className: 'icex-fixer-value' }, t('settings.anchors.delayValue', { ms: settings.tooltipDelayMs }))),
              h('input', {
                type: 'range',
                className: 'icex-fixer-range',
                min: MIN_DELAY,
                max: MAX_DELAY,
                step: 100,
                value: settings.tooltipDelayMs,
                'aria-label': t('settings.anchors.delay'),
                disabled: bare.active,
                onChange: function (event) {
                  settingsStore.update({ tooltipDelayMs: Number(event.target.value) })
                },
              }),
              h('div', { className: 'icex-fixer-scale' },
                h('span', null, t('settings.anchors.delayMin', { ms: MIN_DELAY })),
                h('span', null, t('settings.anchors.delayMax', { ms: MAX_DELAY }))))),
          h(SettingRow, {
            title: t('settings.anchors.native'),
            description: t('settings.anchors.nativeDesc'),
            switchRow: true,
          },
            h(Toggle, {
              checked: settings.hideNativeRail,
              label: t('settings.anchors.native'),
              disabled: bare.active,
              onChange: function (checked) {
                settingsStore.update({ hideNativeRail: checked })
              },
            })),
          h(SettingRow, {
            title: t('settings.summon.title'),
            description: t('settings.summon.desc'),
            switchRow: true,
          },
            h('span', { className: 'icex-fixer-value' }, t('settings.summon.status')))),
        h('div', { className: 'icex-fixer-hint' }, t('settings.saved')),
        bare.active === true ? h('div', { className: 'icex-fixer-hint' }, t('bare.settingsHint')) : null,
        h('div', { className: 'icex-fixer-heading' }, t('bare.section')),
        h('div', { className: 'icex-fixer-card' }, h(BareModeSection, { t: props.t })),
        h('div', { className: 'icex-fixer-hint' }, t('bare.hint')))
    }

    function selectChatItems(snapshot) {
      if (snapshot === undefined || snapshot === null || snapshot.navigation === undefined) return null
      return snapshot.navigation.items()
    }

    function AnchorRail(props) {
      const t = translator(props.t)
      const settings = useSettings()
      const hostRef = props.hostRef
      const sessionId = props.sessionId
      const chatHook = props.useChat
      const projectionHook = props.useProjection
      const outline = typeof projectionHook === 'function' ? projectionHook('turnOutline') : undefined
      const chatItems = typeof chatHook === 'function' ? chatHook(selectChatItems) : null
      const anchors = useMemo(function () {
        return mergeAnchors(outline, chatItems)
      }, [outline, chatItems])
      const activeState = useState(null)
      const active = activeState[0]
      const setActive = activeState[1]
      const busyState = useState(null)
      const busy = busyState[0]
      const setBusy = busyState[1]
      const geomState = useState(null)
      const geom = geomState[0]
      const setGeom = geomState[1]
      const tipState = useState(null)
      const tip = tipState[0]
      const setTip = tipState[1]
      const scrollerRef = useRef(null)
      const timerRef = useRef(null)
      const hoverRef = useRef(null)
      const frameRef = useRef(0)

      const getParts = useCallback(function () {
        const host = hostRef.current
        const body = host !== null && host !== undefined && host.closest !== undefined
          ? host.closest('[data-conversation-content]')
          : null
        const scroller = body === null ? null : body.querySelector('[data-conversation-scroll]')
        return { body: body, scroller: scroller }
      }, [hostRef])

      const clearTimer = useCallback(function () {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current)
          timerRef.current = null
        }
      }, [])

      useEffect(function () {
        setActive(null)
        setTip(null)
        clearTimer()
        hoverRef.current = null
      }, [sessionId, clearTimer])

      const measure = useCallback(function () {
        const parts = getParts()
        const body = parts.body
        const scroller = parts.scroller
        if (body === null || scroller === null) {
          setGeom(null)
          return
        }
        const bodyRect = body.getBoundingClientRect()
        const scrollRect = scroller.getBoundingClientRect()
        if (bodyRect.width <= 0 || bodyRect.height <= 0 || scrollRect.height <= 0) {
          setGeom(null)
          return
        }
        const column = body.querySelector('[data-chat-flow]')
        if (column === null) {
          setGeom(null)
          return
        }
        const columnRect = column.getBoundingClientRect()
        if (columnRect.width <= 0 || columnRect.left - scrollRect.left < RAIL_GAP + 4) {
          setGeom(null)
          return
        }
        const composer = scroller.querySelector('[data-composer-seat]')
        const composerRect = composer === null ? null : composer.getBoundingClientRect()
        const bandBottom = composerRect !== null && composerRect.top > scrollRect.top
          ? Math.min(scrollRect.bottom, composerRect.top)
          : scrollRect.bottom
        const bandHeight = Math.max(0, bandBottom - scrollRect.top)
        const next = {
          left: Math.round(columnRect.left - RAIL_GAP),
          top: Math.round(scrollRect.top + bandHeight / 2),
          maxHeight: Math.round(Math.max(140, Math.min(bandHeight * 0.6, 440))),
        }
        setGeom(function (previous) {
          if (previous !== null
            && Math.abs(previous.left - next.left) < 0.5
            && Math.abs(previous.top - next.top) < 0.5
            && Math.abs(previous.maxHeight - next.maxHeight) < 0.5) return previous
          return next
        })
      }, [getParts])

      const syncActive = useCallback(function () {
        const scroller = getParts().scroller
        if (scroller === null) return
        const rect = scroller.getBoundingClientRect()
        const line = rect.top + Math.min(96, rect.height * 0.2)
        const rows = scroller.querySelectorAll('[data-chat-flow-kind="user"][data-chat-turn]')
        let current = null
        let first = null
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          const turn = Number(row.getAttribute('data-chat-turn'))
          if (!Number.isSafeInteger(turn)) continue
          if (first === null) first = turn
          const box = row.getBoundingClientRect()
          if (box.height > 0 && box.top <= line) current = turn
        }
        const next = current === null ? first : current
        setActive(function (previous) {
          return previous === next ? previous : next
        })
      }, [getParts])

      useLayoutEffect(function () {
        measure()
      }, [measure, anchors.length, settings.anchorsEnabled])

      useEffect(function () {
        measure()
        syncActive()
        const parts = getParts()
        if (parts.body === null || parts.scroller === null) return undefined
        let frame = 0
        let observer = null
        let column = null
        let mutations = null

        function refreshColumn() {
          if (observer === null) return
          const next = parts.body.querySelector('[data-chat-flow]')
          if (next === column) return
          if (column !== null) observer.unobserve(column)
          column = next
          if (column !== null) observer.observe(column)
        }

        function schedule() {
          if (frame !== 0) return
          frame = requestAnimationFrame(function () {
            frame = 0
            measure()
            syncActive()
            refreshColumn()
          })
        }

        window.addEventListener('resize', schedule)
        if (typeof ResizeObserver === 'function') {
          observer = new ResizeObserver(schedule)
          observer.observe(parts.body)
          observer.observe(parts.scroller)
          const composer = parts.scroller.querySelector('[data-composer-seat]')
          if (composer !== null) observer.observe(composer)
          refreshColumn()
        }
        if (typeof MutationObserver === 'function') {
          mutations = new MutationObserver(function (records) {
            let relevant = false
            for (let index = 0; index < records.length && !relevant; index += 1) {
              const record = records[index]
              const nodes = record.addedNodes.length > 0 ? record.addedNodes : record.removedNodes
              for (let nodeIndex = 0; nodeIndex < nodes.length && !relevant; nodeIndex += 1) {
                const node = nodes[nodeIndex]
                if (node.nodeType !== 1) continue
                if (column === null) {
                  if (node.matches('[data-chat-flow]') || node.querySelector('[data-chat-flow]') !== null) {
                    relevant = true
                  }
                } else if (node === column || node.contains(column)) {
                  relevant = true
                }
              }
            }
            if (relevant) schedule()
          })
          mutations.observe(parts.body, { childList: true, subtree: true })
        }
        return function () {
          window.removeEventListener('resize', schedule)
          if (frame !== 0) cancelAnimationFrame(frame)
          if (observer !== null) observer.disconnect()
          if (mutations !== null) mutations.disconnect()
        }
      }, [getParts, measure, syncActive, sessionId, anchors.length])

      useEffect(function () {
        const scroller = getParts().scroller
        if (scroller === null) return undefined
        const onScroll = function () {
          if (frameRef.current !== 0) return
          frameRef.current = requestAnimationFrame(function () {
            frameRef.current = 0
            syncActive()
            clearTimer()
            hoverRef.current = null
            setTip(null)
          })
        }
        scroller.addEventListener('scroll', onScroll, { passive: true })
        return function () {
          scroller.removeEventListener('scroll', onScroll)
          if (frameRef.current !== 0) {
            cancelAnimationFrame(frameRef.current)
            frameRef.current = 0
          }
        }
      }, [getParts, syncActive, clearTimer, sessionId, anchors.length])

      useEffect(function () {
        const scroller = scrollerRef.current
        if (scroller === null || active === null) return
        const buttons = scroller.querySelectorAll('[data-turn]')
        let button = null
        for (let index = 0; index < buttons.length; index += 1) {
          if (buttons[index].getAttribute('data-turn') === String(active)) {
            button = buttons[index]
            break
          }
        }
        if (button === null) return
        const top = button.offsetTop
        const bottom = top + button.offsetHeight
        if (top < scroller.scrollTop + 6 || bottom > scroller.scrollTop + scroller.clientHeight - 6) {
          scroller.scrollTop = Math.max(0, top - scroller.clientHeight / 2)
        }
      }, [active, anchors.length])

      useEffect(function () {
        return function () {
          clearTimer()
          if (frameRef.current !== 0) cancelAnimationFrame(frameRef.current)
        }
      }, [clearTimer])

      const showTip = useCallback(function (turn) {
        const scroller = scrollerRef.current
        if (scroller === null) return
        const buttons = scroller.querySelectorAll('[data-turn]')
        let button = null
        for (let index = 0; index < buttons.length; index += 1) {
          if (buttons[index].getAttribute('data-turn') === String(turn)) {
            button = buttons[index]
            break
          }
        }
        if (button === null) return
        let prompt = ''
        const row = findUserRow(scroller, turn)
        if (row !== null) {
          const bubble = row.querySelector('[data-message-bubble]')
          const text = bubble === null ? row.textContent : bubble.textContent
          if (typeof text === 'string') prompt = clip(flatten(text), 600)
        }
        if (prompt === '') {
          const anchor = anchors.find(function (candidate) {
            return candidate.turn === turn
          })
          if (anchor !== undefined) prompt = flatten(anchor.prompt)
        }
        const rect = button.getBoundingClientRect()
        setTip({
          turn: turn,
          left: Math.round(rect.right + 10),
          top: Math.round(rect.top + rect.height / 2),
          prompt: prompt,
        })
      }, [anchors])

      const enter = useCallback(function (turn) {
        clearTimer()
        hoverRef.current = turn
        setTip(null)
        timerRef.current = setTimeout(function () {
          timerRef.current = null
          if (hoverRef.current !== turn) return
          showTip(turn)
        }, settings.tooltipDelayMs)
      }, [clearTimer, settings.tooltipDelayMs, showTip])

      const leave = useCallback(function () {
        hoverRef.current = null
        clearTimer()
        setTip(null)
      }, [clearTimer])

      const jump = useCallback(async function (anchor) {
        leave()
        setBusy(anchor.turn)
        try {
          const scroller = getParts().scroller
          if (scroller === null) return
          let row = findAnchor(scroller, anchor)
          if (row === null && anchor.seq !== null && sessionId !== undefined && runtimeContext !== null) {
            const binding = runtimeContext.sessions.binding(sessionId)
            if (binding !== undefined && binding.session !== undefined
              && typeof binding.session.loadThrough === 'function') {
              try {
                await binding.session.loadThrough(anchor.seq)
              } catch (error) {
                console.warn('[icex-dsh-fixer] could not load history for turn', anchor.turn, error)
              }
              row = await waitForAnchor(scroller, anchor, 6000)
            }
          }
          if (row === null) return
          const scrollerRect = scroller.getBoundingClientRect()
          const rowRect = row.getBoundingClientRect()
          const target = scroller.scrollTop + (rowRect.top - scrollerRect.top) - 24
          scroller.scrollTo({ top: Math.max(0, target), behavior: 'smooth' })
          setActive(anchor.turn)
        } finally {
          setBusy(null)
        }
      }, [getParts, leave, sessionId])

      const visible = settings.anchorsEnabled && anchors.length >= 2 && geom !== null
      useEffect(function () {
        if (!visible || typeof document === 'undefined') return undefined
        document.documentElement.setAttribute('data-icex-fixer-rail-mounted', '')
        return function () {
          document.documentElement.removeAttribute('data-icex-fixer-rail-mounted')
        }
      }, [visible])

      if (!settings.anchorsEnabled) return null
      if (anchors.length < 2) return null
      if (geom === null) return null
      if (typeof window === 'undefined') return null

      const tipAnchor = tip === null ? null : anchors.find(function (anchor) {
        return anchor.turn === tip.turn
      })
      const tipIndex = tipAnchor === undefined || tipAnchor === null ? -1 : anchors.indexOf(tipAnchor)
      const tipPrompt = tip === null ? '' : tip.prompt
      const tipTop = tip === null ? 0 : clamp(tip.top, 76, window.innerHeight - 76)

      return h(Fragment, null,
        h('nav', {
          className: 'icex-rail',
          'aria-label': t('rail.label'),
          style: {
            left: geom.left + 'px',
            top: geom.top + 'px',
            maxHeight: geom.maxHeight + 'px',
          },
        },
          h('div', {
            className: 'icex-rail-scroller',
            ref: scrollerRef,
            onScroll: function () {
              setTip(null)
            },
          },
            anchors.map(function (anchor, index) {
              const prompt = flatten(anchor.prompt)
              const label = prompt === '' ? t('rail.fallback', { turn: anchor.turn }) : prompt
              return h('button', {
                key: anchor.turn,
                type: 'button',
                className: 'icex-rail-btn',
                'data-turn': anchor.turn,
                'data-active': active === anchor.turn ? '' : undefined,
                'data-busy': busy === anchor.turn ? '' : undefined,
                'aria-current': active === anchor.turn ? 'true' : undefined,
                'aria-label': t('rail.jump', { index: index + 1, prompt: clip(label, 90) }),
                onPointerEnter: function () {
                  enter(anchor.turn)
                },
                onPointerLeave: leave,
                onFocus: function () {
                  clearTimer()
                  showTip(anchor.turn)
                },
                onBlur: leave,
                onClick: function () {
                  void jump(anchor)
                },
              }, h('span', { className: 'icex-rail-dot', 'aria-hidden': true }))
            })),
        ),
        tip !== null && tipAnchor !== null && tipAnchor !== undefined
          ? h('div', {
            className: 'icex-tip',
            role: 'tooltip',
            style: {
              left: tip.left + 'px',
              top: tipTop + 'px',
            },
          },
            h('div', { className: 'icex-tip-head' }, t('rail.input', { index: tipIndex + 1 })),
            h('div', { className: 'icex-tip-text' }, tipPrompt === ''
              ? t('rail.fallback', { turn: tip.turn })
              : tipPrompt))
          : null,
      )
    }

    function AnchorDock(props) {
      const settings = useSettings()
      const bare = useBare()
      const hostRef = useRef(null)
      const readyState = useState(false)
      const portalReady = readyState[0]
      const setPortalReady = readyState[1]

      useEffect(function () {
        setPortalReady(true)
      }, [setPortalReady])

      const host = h('span', { ref: hostRef, hidden: true, 'data-icex-fixer-anchor-host': '' })
      const canPortal = settings.anchorsEnabled
        && bare.active !== true
        && portalReady
        && typeof document !== 'undefined'
        && document.body !== null
      if (!canPortal) return host
      return h(Fragment, null,
        host,
        createPortal(
          h(AnchorRail, Object.assign({}, props, { hostRef: hostRef })),
          document.body,
        ))
    }

    const en = {
      'settings.title': 'Adjustments',
      'settings.anchors.title': 'Input anchor rail',
      'settings.anchors.desc': 'Show a vertical dot rail left of the transcript, one dot for each user input. Hover to preview the input; click to scroll to it.',
      'settings.anchors.enable': 'Show the anchor rail',
      'settings.anchors.delay': 'Preview delay',
      'settings.anchors.delayDesc': 'How long the pointer must rest on a dot before its input appears.',
      'settings.anchors.delayValue': '{ms} ms',
      'settings.anchors.delayMin': '{ms} ms',
      'settings.anchors.delayMax': '{ms} ms',
      'settings.anchors.native': 'Hide the built-in turn rail',
      'settings.anchors.nativeDesc': 'The built-in rail on the right also navigates turns. Hide it while this plugin draws its rail on the left.',
      'settings.summon.title': 'Double-tap right Option',
      'settings.summon.desc': 'Double-tap right Option to switch to the DSH window and bring it to the top of its desktop: full width, current height, focused. If the window is on another desktop or display, it switches there instead of moving the window; All Desktops in the Dock menu makes it follow every desktop, with the tradeoff that it is visible everywhere while open.',
      'settings.summon.status': 'Always on · macOS',
      'settings.saved': 'Stored in this browser; the options belong to this plugin.',
      'bare.section': 'Bare mode',
      'bare.title': 'Turn every plugin off',
      'bare.desc': 'Close every plugin layer and look at DSH as it ships. The plugins stay installed; this same switch turns them all back on. This plugin stays loaded so the switch is reachable, and hides its own changes while bare mode is on.',
      'bare.off': 'Plugins run as configured',
      'bare.on': 'Plugins off: {count}',
      'bare.busy': 'Working…',
      'bare.confirm': 'Turn off every plugin? Sessions and settings stay untouched, and this same switch turns them all back on. The page reloads once after the change.',
      'bare.confirmCount': 'Turn off {count} plugins? Only the DSH core, the Plugins page, and this plugin stay on. Sessions and settings are untouched, and the same switch brings them all back. The page reloads once.',
      'bare.partial': 'These plugins stayed on: {names}. The rest are off; reload the page to see it.',
      'bare.partialOff': 'These plugins did not come back on: {names}. Reload the page to see the rest.',
      'bare.failed': 'Failed: {message}',
      'bare.restart': 'These plugins take effect after a DSH restart: {names}',
      'bare.empty': 'There is no plugin to turn off.',
      'bare.keepAlive': 'Tip: do not turn this plugin off in the list, or this restore switch disappears with it.',
      'bare.settingsHint': 'While bare mode is on, the rail options above are paused; they return when bare mode is off.',
      'bare.noManager': 'This profile has no plugin manager, so it cannot switch plugins.',
      'bare.busyError': 'Another plugin change is in progress. Refresh, then try again.',
      'bare.unauthorized': 'The session expired. Refresh the page, then try again.',
      'bare.offline': 'Cannot reach the Host. Refresh the page, then try again.',
      'bare.hint': 'The state lives in this profile on the Host, so it survives a reload or restart.',
      'rail.label': 'Input anchors',
      'rail.jump': 'Jump to input {index}: {prompt}',
      'rail.input': 'Input {index}',
      'rail.fallback': 'Turn {turn}',
      'menu.deleteSession': 'Delete session',
      'menu.deleting': 'Deleting…',
      'menu.deleteConfirm': 'Delete this session? A running session is stopped first; its log moves to the trash folder, and the current view returns to a new Session.',
      'menu.deleteFailed': 'Delete failed: {message}',
      'menu.deleteLive': 'This session is running and could not be stopped. Try again in a moment.',
      'edit.title': 'Edit and resend',
      'edit.cancel': 'Cancel',
      'edit.send': 'Resend',
      'edit.sending': 'Creating branch…',
      'edit.hint': 'Enter to resend · Shift+Enter new line · Esc cancel',
      'edit.failed': 'Could not resend: {message}',
      'edit.unavailable': 'editing is unavailable',
      'edit.offline': 'the Host is unreachable',
      'edit.branchBadge': 'Branched',
      'edit.openBranch': 'Open the branch',
      'edit.toast': 'Branched from that message',
      'edit.back': 'Back to original session',
    }

    const zh = {
      'settings.title': '界面调整',
      'settings.anchors.title': '输入锚点导航',
      'settings.anchors.desc': '在会话内容区左侧显示一列圆点，每条用户输入对应一个圆点。悬停预览输入内容，点击滚动到该输入。',
      'settings.anchors.enable': '显示锚点导航',
      'settings.anchors.delay': '悬停提示延迟',
      'settings.anchors.delayDesc': '指针在圆点上停留多久后显示输入内容。',
      'settings.anchors.delayValue': '{ms} 毫秒',
      'settings.anchors.delayMin': '{ms} 毫秒',
      'settings.anchors.delayMax': '{ms} 毫秒',
      'settings.anchors.native': '隐藏原生右侧轮次导航',
      'settings.anchors.nativeDesc': 'DSH 自带的右侧轮次导航也用于跳转。启用左侧圆点时，可以隐藏它以避免两套导航重复。',
      'settings.summon.title': '双击右 Option 唤起窗口',
      'settings.summon.desc': '双击右 Option 会切到 DSH 窗口所在的桌面并置顶定位：顶部、全宽、保持当前高度并聚焦。窗口在别的桌面/显示器时会切过去，而不是把窗口搬过来；在 Dock 里设为“所有桌面”可让它跟随每个桌面，代价是窗口打开时每个桌面都可见。',
      'settings.summon.status': '默认开启 · macOS',
      'settings.saved': '设置保存在当前浏览器，选项仅属于本插件。',
      'bare.section': '纯净模式',
      'bare.title': '关闭全部插件',
      'bare.desc': '关掉所有插件层，只看 DSH 原貌。插件不会被卸载，拨回来就全部恢复；本插件保持加载以便随时恢复，开启时会隐藏自己的界面改动。',
      'bare.off': '插件按当前设置运行',
      'bare.on': '已关闭 {count} 个插件',
      'bare.busy': '处理中…',
      'bare.confirm': '关闭全部插件？会话和设置不受影响，用同一个开关就能全部恢复。切换后页面会刷新一次。',
      'bare.confirmCount': '关闭 {count} 个插件？只保留 DSH 内核、插件页和本插件。会话和设置不受影响，同一个开关就能全部恢复。切换后页面会刷新一次。',
      'bare.partial': '这些插件没能关闭：{names}。其余插件已关闭，刷新页面后生效。',
      'bare.partialOff': '这些插件没能恢复：{names}。刷新页面后生效。',
      'bare.failed': '失败：{message}',
      'bare.restart': '这些插件要重启 DSH 后才生效：{names}',
      'bare.empty': '没有可关闭的插件。',
      'bare.keepAlive': '提示：别在插件列表里停用本插件，否则这个恢复入口会一起消失。',
      'bare.settingsHint': '纯净模式开启时，上面的锚点设置暂时不生效；关掉纯净模式后恢复。',
      'bare.noManager': '这个 profile 没有插件管理器，无法切换插件。',
      'bare.busyError': '另一处正在切换插件，刷新后再试。',
      'bare.unauthorized': '登录状态过期，刷新页面后再试。',
      'bare.offline': '连不上 Host，刷新页面后再试。',
      'bare.hint': '状态保存在这个 profile 的 Host 上，刷新或重启后仍然有效。',
      'rail.label': '输入锚点',
      'rail.jump': '跳转到第 {index} 条输入：{prompt}',
      'rail.input': '第 {index} 条输入',
      'menu.deleteSession': '删除会话',
      'menu.deleting': '删除中…',
      'menu.deleteConfirm': '删除这个会话？正在运行的会话会先被停止；日志会移到回收站目录，当前视图会回到新会话。',
      'menu.deleteFailed': '删除失败：{message}',
      'menu.deleteLive': '这个会话还在运行，没能停下来；稍后再试一次。',
      'edit.title': '编辑并重发',
      'edit.cancel': '取消',
      'edit.send': '重发',
      'edit.sending': '正在创建分支…',
      'edit.hint': 'Enter 重发 · Shift+Enter 换行 · Esc 取消',
      'edit.failed': '重发失败：{message}',
      'edit.unavailable': '编辑不可用',
      'edit.offline': '无法连接宿主',
      'edit.branchBadge': '已分支',
      'edit.openBranch': '打开分支',
      'edit.toast': '已从该条消息创建分支',
      'edit.back': '返回原会话',
      'rail.fallback': '第 {turn} 轮',
    }

    const STYLE_LINES = [
      '.icex-fixer-settings { display: flex; flex-direction: column; gap: 8px; padding: 2px 0 4px; }',
      '.icex-fixer-heading { font-size: 13px; font-weight: 600; line-height: 20px; color: var(--dsw-alias-label-primary); }',
      '.icex-fixer-card { border: 1px solid var(--dsw-alias-border-l1); border-radius: var(--dsw-radius-lg); background: var(--dsw-alias-bg-layer-1); padding: 0 14px; }',
      '.icex-fixer-row { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 12px 20px; padding: 14px 0; border-top: 1px solid var(--dsw-alias-border-l1); }',
      '.icex-fixer-row:first-child { border-top: 0; }',
      '.icex-fixer-copy { flex: 1 1 240px; min-width: 0; }',
      '.icex-fixer-title { font-size: 13px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }',
      '.icex-fixer-desc { margin-top: 2px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }',
      '.icex-fixer-control { flex: 0 1 240px; min-width: 190px; display: flex; flex-direction: column; gap: 6px; }',
      '.icex-fixer-switchRow { align-items: center; }',
      '.icex-fixer-switchRow .icex-fixer-control { flex: 0 0 auto; min-width: 0; align-items: flex-end; }',
      '.icex-fixer-switch { position: relative; width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px; background: var(--dsw-alias-border-l2); cursor: pointer; transition: background-color 140ms ease; }',
      '.icex-fixer-switch[aria-checked="true"] { background: var(--dsw-alias-state-business-primary); }',
      '.icex-fixer-knob { display: block; width: 16px; height: 16px; border-radius: 50%; background: var(--dsw-alias-label-on-color); transition: transform 140ms ease; }',
      '.icex-fixer-switch[aria-checked="true"] .icex-fixer-knob { transform: translateX(16px); }',
      '.icex-fixer-switch:focus-visible { outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); outline-offset: 2px; }',
      '.icex-fixer-width { display: flex; flex-direction: column; gap: 6px; width: 100%; }',
      '.icex-fixer-widthHead { display: flex; align-items: center; justify-content: space-between; gap: 8px; }',
      '.icex-fixer-value { font-size: 12px; line-height: 18px; font-variant-numeric: tabular-nums; color: var(--dsw-alias-label-secondary); }',
      '.icex-fixer-link { padding: 0; border: 0; background: none; color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }',
      '.icex-fixer-link:hover { text-decoration: underline; }',
      '.icex-fixer-range { width: 100%; accent-color: var(--dsw-alias-state-business-primary); }',
      '.icex-fixer-scale { display: flex; justify-content: space-between; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-caption); font-variant-numeric: tabular-nums; }',
      '.icex-fixer-hint { margin-top: 2px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-caption); }',
      '.icex-fixer-bareControl { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; text-align: right; max-width: 260px; }',
      '.icex-fixer-switch:disabled { opacity: 0.45; cursor: not-allowed; }',
      '.icex-fixer-range:disabled { opacity: 0.45; }',
      '.icex-fixer-bareHint { margin: -8px 0 12px; }',
      '.icex-fixer-errorBlock { margin: -8px 0 12px; padding: 8px 10px; border: 1px solid var(--dsw-alias-state-error-primary, #d5484b); border-radius: var(--dsw-radius-md); font-size: 12px; line-height: 18px; color: var(--dsw-alias-state-error-primary, #d5484b); overflow-wrap: anywhere; }',
      '.icex-rail { position: fixed; z-index: 40; width: 18px; transform: translateY(-50%); pointer-events: auto; }',
      '.icex-rail-scroller { position: relative; max-height: inherit; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: none; padding: 2px 0; }',
      '.icex-rail-scroller::-webkit-scrollbar { display: none; }',
      '.icex-rail-btn { display: grid; place-items: center; width: 18px; height: 14px; padding: 0; border: 0; background: transparent; cursor: pointer; }',
      '.icex-rail-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--dsw-alias-border-l3); opacity: 0.75; transition: transform 120ms ease, background-color 120ms ease, opacity 120ms ease; }',
      '.icex-rail-btn:hover .icex-rail-dot { background: var(--dsw-alias-label-secondary); opacity: 1; transform: scale(1.6); }',
      '.icex-rail-btn[data-active] .icex-rail-dot { background: var(--dsw-alias-label-primary); opacity: 1; transform: scale(1.5); }',
      '.icex-rail-btn[data-busy] .icex-rail-dot { animation: icex-fixer-pulse 900ms ease-in-out infinite; }',
      '.icex-rail-btn:focus { outline: none; }',
      '.icex-rail-btn:focus-visible .icex-rail-dot { box-shadow: 0 0 0 2px var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary)); }',
      '@keyframes icex-fixer-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }',
      '.icex-tip { position: fixed; z-index: 41; transform: translateY(-50%); max-width: 320px; padding: 8px 10px; border-radius: var(--dsw-radius-md); background: var(--dsw-specific-menu); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-panel); backdrop-filter: var(--dsw-menu-backdrop-filter); pointer-events: none; }',
      '.icex-tip-head { margin-bottom: 2px; font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }',
      '.icex-tip-text { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 18px; }',
      'html[data-icex-fixer-hide-native-rail][data-icex-fixer-rail-mounted] [data-conversation-content] nav[aria-label] { display: none !important; }',
      '@media (prefers-reduced-motion: reduce) { .icex-rail-dot { transition: none; } .icex-rail-btn[data-busy] .icex-rail-dot { animation: none; } }',
      '.icex-edit-wrap { display: inline-flex; align-items: center; gap: 6px; }',
      '.icex-edit-pencil { display: inline-flex; align-items: center; justify-content: center; width: calc(28px + var(--dsh-content-font-delta, 0px)); height: calc(28px + var(--dsh-content-font-delta, 0px)); padding: 6px; border: 0; border-radius: var(--dsw-radius-sm); background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; transition: background-color 120ms ease, color 120ms ease; }',
      '.icex-edit-pencil svg { width: calc(15px + var(--dsh-content-font-delta, 0px)); height: calc(15px + var(--dsh-content-font-delta, 0px)); }',
      '.icex-edit-pencil:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-secondary); }',
      '.icex-edit-pencil:disabled { opacity: 0.4; cursor: default; }',
      '.icex-edit-badge { height: 20px; padding: 0 8px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 16%, transparent); color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 11px; line-height: 20px; cursor: pointer; }',
      '.icex-edit-badge:hover { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 26%, transparent); }',
      '.icex-edit-overlay { position: fixed; z-index: 60; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--dsw-alias-state-business-primary); border-radius: var(--dsw-radius-lg); background: var(--dsw-specific-menu); box-shadow: var(--dsw-elevation-panel); }',
      '.icex-edit-textarea { box-sizing: border-box; width: 100%; min-height: 64px; max-height: 44vh; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; resize: vertical; outline: none; }',
      '.icex-edit-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }',
      '.icex-edit-hint { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-tertiary); }',
      '.icex-edit-buttons { display: inline-flex; align-items: center; gap: 6px; }',
      '.icex-edit-cancel, .icex-edit-send { height: 28px; padding: 0 12px; border-radius: var(--dsw-radius-md); font: inherit; font-size: 12px; cursor: pointer; }',
      '.icex-edit-cancel { border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-secondary); }',
      '.icex-edit-send { border: 0; background: var(--dsw-alias-state-business-primary); color: var(--dsw-alias-label-on-color); }',
      '.icex-edit-send:disabled, .icex-edit-cancel:disabled { opacity: 0.55; cursor: default; }',
      '.icex-edit-error { padding: 6px 8px; border-radius: var(--dsw-radius-md); background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #d5484b) 12%, transparent); color: var(--dsw-alias-state-error-primary, #d5484b); font-size: 12px; line-height: 18px; overflow-wrap: anywhere; }',
      '.icex-edit-toast { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 80; display: flex; align-items: center; gap: 12px; max-width: min(560px, calc(100vw - 32px)); padding: 8px 12px; border-radius: var(--dsw-radius-lg); background: var(--dsw-specific-menu); color: var(--dsw-alias-label-primary); box-shadow: var(--dsw-elevation-panel); font-size: 12px; line-height: 18px; }',
      '.icex-edit-toastAction { padding: 0; border: 0; background: none; color: var(--dsw-alias-state-business-primary); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }',
      '.icex-edit-toastAction:hover { text-decoration: underline; }',
    ]

    const STYLES = STYLE_LINES.join(NEWLINE)

    function installStyles() {
      if (typeof document === 'undefined' || document.head === null) return function () {}
      const tag = document.createElement('style')
      tag.dataset.plugin = PACKAGE
      tag.dataset.pluginCss = PACKAGE + '/client.css'
      tag.textContent = STYLES
      document.head.appendChild(tag)
      return function () {
        tag.remove()
      }
    }

    function syncNativeRailAttribute() {
      if (typeof document === 'undefined') return
      const state = settingsStore.get()
      document.documentElement.toggleAttribute(
        'data-icex-fixer-hide-native-rail',
        state.anchorsEnabled && state.hideNativeRail && bareStore.get().active !== true,
      )
    }

    /**
     * Drop the row from the sidebar without reloading the page: the workspace
     * service owns the session list store and updates it when a session is
     * archived. Falls back to a reload only when that service is unavailable.
     */
    function hideRow(sessionId) {
      let workspace
      try {
        workspace = runtimeContext?.uiWorkspace
      } catch (error) {
        workspace = undefined
      }
      if (workspace !== undefined && typeof workspace.archiveSession === 'function') {
        return workspace.archiveSession(sessionId, { stopActivity: true }).catch(function () {
          if (typeof window !== 'undefined') window.location.reload()
        })
      }
      if (typeof window !== 'undefined') window.location.reload()
      return Promise.resolve()
    }

    /**
     * Session row menu item: delete one session by moving its log to the trash.
     * The slot hands over the session id (as a string or a props object).
     */
    function DeleteSessionItem(props) {
      const t = translator(props !== null && typeof props === 'object' ? props.t : undefined)
      const bare = useBare()
      const sessionId = typeof props === 'string'
        ? props
        : props !== null && typeof props === 'object'
          ? props.sessionId ?? props.id ?? props.value
          : undefined
      const busyState = useState(false)
      const busy = busyState[0]
      if (bare.active === true) return null
      if (typeof sessionId !== 'string' || sessionId === '') return null

      function remove() {
        if (typeof window === 'undefined') return
        if (window.confirm(t('menu.deleteConfirm')) !== true) return
        busyState[1](true)
        fetch('/api/icex-fixer/delete-session', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: sessionId }),
        }).then(function (response) {
          return response.json().then(function (body) {
            if (body.ok !== true) {
              const failure = new Error(body.error ?? String(response.status))
              failure.code = body.code
              throw failure
            }
            return hideRow(sessionId)
          })
        }).catch(function (error) {
          busyState[1](false)
          window.alert(error.code === 'live' ? t('menu.deleteLive') : t('menu.deleteFailed', { message: String(error.message ?? error) }))
        })
      }

      return h(primitives.MenuItemButton, {
        icon: h(primitives.IconTrashOutlineRegular, { size: 14, 'aria-hidden': 'true' }),
        disabled: busy,
        onSelect: remove,
        style: { color: 'var(--dsw-alias-state-error-primary, #d5484b)' },
      }, busy ? t('menu.deleting') : t('menu.deleteSession'))
    }

    /*
     * Edit-and-resend. The Host forks the session just before a turn and
     * prompts the child with the rewritten text; this half decorates each sent
     * user bubble with a pencil, edits the text in a bubble-sized overlay, and
     * then opens the branch. A branch badge stays beside the original turn.
     */

    const EDIT_WRAP = 'icex-edit-wrap'

    /** The pencil glyph, built without innerHTML so text cannot be injected. */
    function pencilIcon() {
      const ns = 'http://www.w3.org/2000/svg'
      const svg = document.createElementNS(ns, 'svg')
      svg.setAttribute('viewBox', '0 0 24 24')
      svg.setAttribute('width', '13')
      svg.setAttribute('height', '13')
      svg.setAttribute('aria-hidden', 'true')
      svg.setAttribute('fill', 'currentColor')
      const path = document.createElementNS(ns, 'path')
      path.setAttribute('d', 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z')
      svg.appendChild(path)
      return svg
    }

    /** Open a session id in this browser through the workspace service. */
    function openBranch(childId) {
      try {
        const workspace = runtimeContext?.uiWorkspace
        if (workspace !== undefined && workspace !== null && typeof workspace.openSession === 'function') {
          Promise.resolve(workspace.openSession(childId)).catch(function () {})
          return true
        }
      } catch (error) {
        // Fall through to the copyable id.
      }
      return false
    }

    /** A short-lived toast with one optional action, portalled to the body. */
    function showBranchToast(message, actionLabel, action) {
      if (typeof document === 'undefined' || document.body === null) return
      const toast = document.createElement('div')
      toast.className = 'icex-edit-toast'
      toast.setAttribute('role', 'status')
      const text = document.createElement('span')
      text.textContent = message
      toast.appendChild(text)
      let timer = null
      function dismiss() {
        if (timer !== null) clearTimeout(timer)
        toast.remove()
      }
      if (typeof actionLabel === 'string' && typeof action === 'function') {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'icex-edit-toastAction'
        button.textContent = actionLabel
        button.addEventListener('click', function () {
          dismiss()
          action()
        })
        toast.appendChild(button)
      }
      document.body.appendChild(toast)
      timer = setTimeout(dismiss, 8000)
    }

    /** Load the branch markers for one session and decorate every sent turn. */
    function installEditBubbles(sessionId, t) {
      if (typeof document === 'undefined' || document.body === null) return function () {}
      const marks = new Map()
      let disposed = false
      let frame = 0
      let overlay = null
      let observer = null

      function findScroller() {
        const content = document.querySelector('[data-conversation-content]')
        const scoped = content === null ? null : content.querySelector('[data-conversation-scroll]')
        return scoped !== null ? scoped : document.querySelector('[data-conversation-scroll]')
      }

      /** The native copy/clock row below the bubble owns icon spacing and hover. */
      function actionsSlot(row, bubble) {
        const slot = row.querySelector('[data-clock="start"]')
        if (slot === null || slot === bubble) return null
        return slot
      }

      /** Keep the badge in sync with the marker map (a turn can be edited twice). */
      function syncBadge(wrap, turn) {
        const previous = wrap.querySelector('.icex-edit-badge')
        if (previous !== null) previous.remove()
        const childId = marks.get(turn)
        if (typeof childId !== 'string') return
        const badge = document.createElement('button')
        badge.type = 'button'
        badge.className = 'icex-edit-badge'
        badge.textContent = t('edit.branchBadge')
        badge.title = t('edit.openBranch')
        badge.addEventListener('click', function () {
          if (openBranch(childId) === false) showBranchToast(childId)
        })
        wrap.insertBefore(badge, wrap.firstChild)
      }

      function buildWrap(turn, row, bubble, slot) {
        const wrap = document.createElement('span')
        wrap.className = EDIT_WRAP
        const pencil = document.createElement('button')
        pencil.type = 'button'
        pencil.className = 'icex-edit-pencil'
        pencil.title = t('edit.title')
        pencil.setAttribute('aria-label', t('edit.title'))
        pencil.appendChild(pencilIcon())
        pencil.addEventListener('click', function () {
          beginEdit(turn, row, bubble, pencil)
        })
        wrap.appendChild(pencil)
        syncBadge(wrap, turn)
        slot.appendChild(wrap)
        return wrap
      }

      function decorate() {
        if (disposed) return
        const area = findScroller()
        if (area === null) return
        const rows = area.querySelectorAll('[data-chat-flow-kind="user"][data-chat-turn]')
        const seen = new Set()
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index]
          const turn = Number(row.getAttribute('data-chat-turn'))
          if (!Number.isSafeInteger(turn) || seen.has(turn)) continue
          const bubble = row.querySelector('[data-message-bubble]')
          if (bubble === null || (bubble.textContent ?? '').trim() === '') continue
          const slot = actionsSlot(row, bubble)
          if (slot === null) continue
          seen.add(turn)
          const existing = row.querySelector('.' + EDIT_WRAP)
          if (existing !== null) {
            syncBadge(existing, turn)
            continue
          }
          buildWrap(turn, row, bubble, slot)
        }
      }

      function schedule() {
        if (frame !== 0 || disposed) return
        frame = requestAnimationFrame(function () {
          frame = 0
          decorate()
        })
      }

      function closeOverlay() {
        if (overlay === null) return
        const current = overlay
        overlay = null
        if (typeof current.restore === 'function') current.restore()
        current.remove()
        window.removeEventListener('resize', current.reposition)
      }

      async function beginEdit(turn, row, bubble, pencil) {
        if (overlay !== null) return
        pencil.disabled = true
        let reply = null
        try {
          const response = await fetch('/api/icex-fixer/branch?sessionId=' + encodeURIComponent(sessionId) + '&turn=' + String(turn), {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
          reply = await response.json().catch(function () { return null })
        } catch (error) {
          reply = null
        }
        pencil.disabled = false
        if (disposed) return
        if (reply === null || reply.ok !== true) {
          showBranchToast(t('edit.failed', { message: reply?.error ?? t('edit.unavailable') }))
          return
        }
        openEditor(turn, row, bubble, reply.text)
      }

      /** Build the bubble-sized editor; the original bubble stays hidden below. */
      function openEditor(turn, row, bubble, original) {
        if (overlay !== null) return
        const element = document.createElement('div')
        element.className = 'icex-edit-overlay'

        const textarea = document.createElement('textarea')
        textarea.className = 'icex-edit-textarea'
        textarea.value = original
        textarea.setAttribute('aria-label', t('edit.title'))
        element.appendChild(textarea)

        const error = document.createElement('div')
        error.className = 'icex-edit-error'
        error.hidden = true
        element.appendChild(error)

        const footer = document.createElement('div')
        footer.className = 'icex-edit-footer'
        const hint = document.createElement('span')
        hint.className = 'icex-edit-hint'
        hint.textContent = t('edit.hint')
        footer.appendChild(hint)
        const buttons = document.createElement('span')
        buttons.className = 'icex-edit-buttons'
        const cancel = document.createElement('button')
        cancel.type = 'button'
        cancel.className = 'icex-edit-cancel'
        cancel.textContent = t('edit.cancel')
        const send = document.createElement('button')
        send.type = 'button'
        send.className = 'icex-edit-send'
        send.textContent = t('edit.send')
        buttons.appendChild(cancel)
        buttons.appendChild(send)
        footer.appendChild(buttons)
        element.appendChild(footer)

        const previousVisibility = bubble.style.visibility
        bubble.style.visibility = 'hidden'

        let busy = false
        let composing = false
        function fail(message) {
          error.textContent = message
          error.hidden = false
        }
        function restore() {
          bubble.style.visibility = previousVisibility
        }
        function reposition() {
          if (overlay === null) return
          const rect = bubble.getBoundingClientRect()
          const column = row.getBoundingClientRect()
          const width = column.width > 0 ? column.width : rect.width
          const left = column.width > 0 ? column.left : rect.left
          element.style.left = Math.round(left) + 'px'
          element.style.top = Math.round(rect.top) + 'px'
          element.style.width = Math.round(width) + 'px'
          element.style.minHeight = Math.round(Math.max(96, rect.height)) + 'px'
          const box = element.getBoundingClientRect()
          if (box.top + box.height > window.innerHeight - 12) {
            element.style.top = Math.max(8, window.innerHeight - box.height - 12) + 'px'
          }
          if (box.left + box.width > window.innerWidth - 12) {
            element.style.left = Math.max(8, window.innerWidth - box.width - 12) + 'px'
          }
        }
        async function submit() {
          if (busy) return
          const text = textarea.value
          if (text.trim() === '') {
            textarea.focus()
            return
          }
          if (text.trim() === original.trim()) {
            closeOverlay()
            return
          }
          busy = true
          error.hidden = true
          cancel.disabled = true
          send.disabled = true
          send.textContent = t('edit.sending')
          let reply = null
          let status = ''
          try {
            const response = await fetch('/api/icex-fixer/branch', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ sessionId: sessionId, turn: turn, text: text }),
            })
            status = String(response.status)
            reply = await response.json().catch(function () { return null })
          } catch (requestError) {
            reply = null
          }
          if (disposed) return
          if (reply !== null && reply.ok === true && typeof reply.sessionId === 'string') {
            marks.set(turn, reply.sessionId)
            closeOverlay()
            decorate()
            showBranchToast(t('edit.toast'), t('edit.back'), function () {
              openBranch(sessionId)
            })
            if (openBranch(reply.sessionId) === false) showBranchToast('session ' + reply.sessionId)
            return
          }
          busy = false
          cancel.disabled = false
          send.disabled = false
          send.textContent = t('edit.send')
          const reason = reply !== null && typeof reply.error === 'string' && reply.error !== ''
            ? reply.error
            : status === '' ? t('edit.offline') : status
          fail(t('edit.failed', { message: reason }))
        }
        function close() {
          closeOverlay()
          if (document.activeElement === textarea) textarea.blur()
        }
        cancel.addEventListener('click', close)
        send.addEventListener('click', submit)
        textarea.addEventListener('compositionstart', function () { composing = true })
        textarea.addEventListener('compositionend', function () { composing = false })
        textarea.addEventListener('keydown', function (event) {
          if (event.isComposing || composing) return
          if (event.key === 'Escape') {
            event.preventDefault()
            close()
            return
          }
          if (event.key !== 'Enter') return
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault()
            submit()
            return
          }
          if (event.shiftKey || event.altKey) return
          event.preventDefault()
          submit()
        })

        document.body.appendChild(element)
        element.restore = restore
        element.reposition = reposition
        overlay = element
        window.addEventListener('resize', reposition)
        reposition()
        textarea.focus()
        textarea.setSelectionRange(textarea.value.length, textarea.value.length)
      }

      fetch('/api/icex-fixer/branches?sessionId=' + encodeURIComponent(sessionId), {
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      }).then(function (response) {
        return response.json()
      }).then(function (body) {
        if (disposed || body === null || body.ok !== true || !Array.isArray(body.items)) return
        for (const item of body.items) {
          if (item !== null && typeof item === 'object' && Number.isSafeInteger(item.turn) && typeof item.childId === 'string') {
            marks.set(item.turn, item.childId)
          }
        }
        decorate()
      }).catch(function () {
        // An older Host half has no marker route; editing still works.
      })

      function relevant(record) {
        const target = record.target
        if (target instanceof Element) {
          if (target.closest('[data-conversation-content]') !== null) return true
          for (const node of record.addedNodes) {
            if (node instanceof Element && (node.matches('[data-conversation-content]') || node.querySelector('[data-conversation-content]') !== null)) return true
          }
        }
        return false
      }

      if (typeof MutationObserver === 'function') {
        observer = new MutationObserver(function (records) {
          for (const record of records) {
            if (relevant(record)) {
              schedule()
              return
            }
          }
        })
        observer.observe(document.body, { childList: true, subtree: true })
      }
      window.addEventListener('resize', schedule)
      decorate()

      return function () {
        disposed = true
        if (frame !== 0) cancelAnimationFrame(frame)
        if (observer !== null) observer.disconnect()
        window.removeEventListener('resize', schedule)
        closeOverlay()
        const wraps = document.querySelectorAll('.' + EDIT_WRAP)
        for (let index = 0; index < wraps.length; index += 1) wraps[index].remove()
        const rows = document.querySelectorAll('.icex-edit-row')
        for (let index = 0; index < rows.length; index += 1) rows[index].classList.remove('icex-edit-row')
      }
    }

    /** Dock entry that owns the per-session bubble editor until the id changes. */
    function EditBubbles(props) {
      const sessionId = typeof props.sessionId === 'string' ? props.sessionId : ''
      const t = translator(props.t)
      const latest = useRef(t)
      latest.current = t
      useEffect(function () {
        if (sessionId === '') return undefined
        return installEditBubbles(sessionId, function (key, values) {
          return latest.current(key, values)
        })
      }, [sessionId])
      return null
    }

    function apply(ctx) {
      runtimeContext = ctx
      ctx.effect(installStyles, 'icex-dsh-fixer: styles')
      ctx.effect(function () {
        let live = true
        bareStatusRequest().then(function (body) {
          if (live) syncBareFromReply(body)
        }).catch(function () {
          // Keep the browser mirror when the Host half cannot answer.
        })
        return function () {
          live = false
        }
      }, 'icex-dsh-fixer: bare mode state')
      ctx.effect(function () {
        if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return function () {}
        function onStorage(event) {
          if (event === null || typeof event !== 'object' || event.key !== BARE_KEY || typeof event.newValue !== 'string') return
          try {
            bareStore.update(JSON.parse(event.newValue))
          } catch (error) {
            // Another document wrote an unreadable value; keep the local one.
          }
        }
        window.addEventListener('storage', onStorage)
        return function () {
          window.removeEventListener('storage', onStorage)
        }
      }, 'icex-dsh-fixer: bare mode storage sync')
      ctx.effect(function () {
        return ctx.locale.register(NS, { en: en, zh: zh })
      }, 'icex-dsh-fixer: locale')
      ctx.effect(function () {
        syncNativeRailAttribute()
        const unsubscribe = settingsStore.subscribe(syncNativeRailAttribute)
        const unsubscribeBare = bareStore.subscribe(syncNativeRailAttribute)
        return function () {
          unsubscribe()
          unsubscribeBare()
          if (typeof document !== 'undefined') {
            document.documentElement.removeAttribute('data-icex-fixer-hide-native-rail')
            document.documentElement.removeAttribute('data-icex-fixer-rail-mounted')
          }
        }
      }, 'icex-dsh-fixer: native rail visibility')
      ctx.slots.inject('conversation.composer.dock', function () {
        return ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'icex-fixer-anchors',
          order: 40,
          locale: NS,
        }, AnchorDock)
      })
      ctx.slots.inject('conversation.composer.dock', function () {
        return ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'icex-fixer-editor',
          order: 41,
          locale: NS,
        }, EditBubbles)
      })
      ctx.slots.inject('plugins.bundle.config', function () {
        return ctx.slots.register({
          name: 'plugins.bundle.config',
          key: PACKAGE,
          locale: NS,
        }, SettingsPage)
      })
      ctx.slots.inject('sidebar.workspaces.session.menu.item', function () {
        return ctx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'icex-fixer-delete-session',
          order: 900,
          locale: NS,
        }, DeleteSessionItem)
      })
    }

    const plugin = {
      inject: ['slots', 'sessions', 'locale'],
      apply: apply,
    }
    if (typeof globalThis !== 'undefined' && globalThis.__ICEX_FIXER_TEST__ === true) {
      plugin.__test = {
        mergeAnchors: mergeAnchors,
        normalizeSettings: normalizeSettings,
        flatten: flatten,
        SettingsPage: SettingsPage,
        findAnchor: findAnchor,
        findUserRow: findUserRow,
        AnchorDock: AnchorDock,
        DeleteSessionItem: DeleteSessionItem,
        EditBubbles: EditBubbles,
        installEditBubbles: installEditBubbles,
        pencilIcon: pencilIcon,
        BareModeSection: BareModeSection,
        bareStore: bareStore,
        readBare: readBare,
        syncBareFromReply: syncBareFromReply,
        syncNativeRailAttribute: syncNativeRailAttribute,
      }
    }
    return plugin
  },
})

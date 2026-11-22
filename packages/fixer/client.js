/**
 * icex-dsh-fixer client bundle.
 *
 * Two browser-side features over the shipped DSH web client:
 * 1. A left-side dot rail anchored on each user turn; hover (1 s by default)
 *    reveals the input, click pages history in when needed and scrolls to it.
 * 2. A settings page for the rail and for the native window summon helper.
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
        onClick: function () {
          props.onChange(!props.checked)
        },
      }, h('span', { className: 'icex-fixer-knob', 'aria-hidden': true }))
    }

    function SettingsPage(props) {
      const t = translator(props.t)
      const settings = useSettings()
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
        h('div', { className: 'icex-fixer-hint' }, t('settings.saved')))
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
      const hostRef = useRef(null)
      const readyState = useState(false)
      const portalReady = readyState[0]
      const setPortalReady = readyState[1]

      useEffect(function () {
        setPortalReady(true)
      }, [setPortalReady])

      const host = h('span', { ref: hostRef, hidden: true, 'data-icex-fixer-anchor-host': '' })
      const canPortal = settings.anchorsEnabled
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
      'rail.label': 'Input anchors',
      'rail.jump': 'Jump to input {index}: {prompt}',
      'rail.input': 'Input {index}',
      'rail.fallback': 'Turn {turn}',
      'menu.deleteSession': 'Delete session',
      'menu.deleting': 'Deleting…',
      'menu.deleteConfirm': 'Delete this session? Its log moves to the trash folder.',
      'menu.deleteFailed': 'Delete failed: {message}',
      'menu.deleteLive': 'This session is open. Switch to another session, then delete it.',
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
      'rail.label': '输入锚点',
      'rail.jump': '跳转到第 {index} 条输入：{prompt}',
      'rail.input': '第 {index} 条输入',
      'menu.deleteSession': '删除会话',
      'menu.deleting': '删除中…',
      'menu.deleteConfirm': '删除这个会话？日志会移到回收站目录，可以再捞回来。',
      'menu.deleteFailed': '删除失败：{message}',
      'menu.deleteLive': '这个会话正开着。先切到别的会话，再回来删除。',
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
        state.anchorsEnabled && state.hideNativeRail,
      )
    }

    /**
     * Session row menu item: delete one session by moving its log to the trash.
     * The slot hands over the session id (as a string or a props object).
     */
    function DeleteSessionItem(props) {
      const t = translator(props !== null && typeof props === 'object' ? props.t : undefined)
      const sessionId = typeof props === 'string'
        ? props
        : props !== null && typeof props === 'object'
          ? props.sessionId ?? props.id ?? props.value
          : undefined
      const busyState = useState(false)
      const busy = busyState[0]
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
            window.location.reload()
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

    function apply(ctx) {
      runtimeContext = ctx
      ctx.effect(installStyles, 'icex-dsh-fixer: styles')
      ctx.effect(function () {
        return ctx.locale.register(NS, { en: en, zh: zh })
      }, 'icex-dsh-fixer: locale')
      ctx.effect(function () {
        syncNativeRailAttribute()
        const unsubscribe = settingsStore.subscribe(syncNativeRailAttribute)
        return function () {
          unsubscribe()
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
      }
    }
    return plugin
  },
})

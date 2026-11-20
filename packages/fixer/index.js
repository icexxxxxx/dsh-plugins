/**
 * Host half of icex-dsh-fixer: starts the macOS summon helper.
 *
 * The helper listens for a right-Option double tap and moves the DSH window to
 * the screen under the pointer. It lives outside the Web client because global
 * key events and native window bounds are not available to a browser plugin.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const helper = join(here, 'native', 'icex-summon')

/**
 * Start the native helper for this profile while the plugin row is active.
 * @param ctx - owning Cordis context.
 */
export function apply(ctx) {
  if (process.platform !== 'darwin') return
  if (!existsSync(helper)) {
    console.warn('[icex-dsh-fixer] native summon helper is missing: ' + helper)
    return
  }
  ctx.effect(() => {
    let disposed = false
    let child = null
    let restartTimer = null
    const start = () => {
      if (disposed) return
      child = spawn(helper, [], { stdio: ['ignore', 'ignore', 'pipe'] })
      child.stderr.on('data', (chunk) => {
        const text = String(chunk).trim()
        if (text !== '') console.warn('[icex-dsh-fixer] summon: ' + text)
      })
      child.on('error', (error) => {
        console.warn('[icex-dsh-fixer] summon helper failed: ' + error.message)
      })
      child.on('exit', (code, signal) => {
        child = null
        if (disposed) return
        if (code !== 0 && signal !== 'SIGTERM') {
          console.warn('[icex-dsh-fixer] summon helper exited: ' + String(code) + '/' + String(signal))
        }
        restartTimer = setTimeout(start, 2000)
      })
    }
    start()
    return () => {
      disposed = true
      if (restartTimer !== null) clearTimeout(restartTimer)
      if (child !== null) child.kill('SIGTERM')
    }
  }, 'icex-dsh-fixer: native summon helper')
}

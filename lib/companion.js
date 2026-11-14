import { spawn } from 'node:child_process'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/** The vendored upstream engine, shipped inside this package. */
export const COMPANION_PATH = fileURLToPath(new URL('../vendor/codex/scripts/codex-companion.mjs', import.meta.url))

const MAX_CAPTURE = 64 * 1024
const KILL_GRACE_MS = 2000

/**
 * GUI apps on macOS launch with a minimal PATH, which hides Homebrew and
 * npm-global installs. Prepend the usual locations so `codex` resolves.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} home
 * @returns {NodeJS.ProcessEnv}
 */
export function augmentPath(env, home = process.env.HOME ?? '') {
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', home ? `${home}/.local/bin` : ''].filter(Boolean)
  const existing = String(env.PATH ?? '').split(':').filter(Boolean)
  /** @type {string[]} */
  const merged = []
  for (const entry of [...extra, ...existing]) {
    if (!merged.includes(entry)) {
      merged.push(entry)
    }
  }
  return { ...env, PATH: merged.join(':') }
}

/**
 * @typedef {object} CompanionResult
 * @property {number | 'TIMEOUT' | 'ABORTED' | 'SPAWN_ERROR'} code
 * @property {string} stdout
 * @property {string} stderr
 * @property {string} [error] Present when the process could not be spawned.
 */

/**
 * @param {{env: NodeJS.ProcessEnv, dataDir: string, sessionId?: string, binDir?: string | null}} options
 * @returns {NodeJS.ProcessEnv}
 */
export function childEnv({ env, dataDir, sessionId, binDir }) {
  const base = augmentPath(env)
  if (binDir) {
    base.PATH = `${binDir}:${base.PATH}`
  }
  base.CLAUDE_PLUGIN_DATA = dataDir
  if (sessionId) {
    base.CODEX_COMPANION_SESSION_ID = sessionId
  }
  return base
}

/**
 * Run the vendored engine once and collect its output.
 *
 * @param {object} options
 * @param {string[]} options.argv Engine arguments, without the script path.
 * @param {string} options.cwd Session working directory.
 * @param {string} options.dataDir Plugin data directory, exported as `CLAUDE_PLUGIN_DATA`.
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.companionPath]
 * @param {string} [options.nodePath]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @param {string} [options.sessionId] Exported as `CODEX_COMPANION_SESSION_ID` so the engine scopes threads per session.
 * @param {string | null} [options.binDir] Directory prepended to PATH (see `prepareCodexBinDir`).
 * @returns {Promise<CompanionResult>}
 */
export function runCompanion(options) {
  const {
    argv,
    cwd,
    dataDir,
    env = process.env,
    companionPath = COMPANION_PATH,
    nodePath = process.execPath,
    timeoutMs = 30 * 60 * 1000,
    signal,
    sessionId,
    binDir = null,
  } = options

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let killTimer

    const child = spawn(nodePath, [companionPath, ...argv], {
      cwd,
      env: childEnv({ env, dataDir, sessionId, binDir }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })

    const killGroup = () => {
      if (child.pid === undefined) {
        return
      }
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        try {
          child.kill('SIGTERM')
        } catch {
          // already gone
        }
      }
      killTimer = setTimeout(() => {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // already gone
        }
      }, KILL_GRACE_MS)
      killTimer.unref?.()
    }

    /** @param {number | 'TIMEOUT' | 'ABORTED' | 'SPAWN_ERROR'} code */
    const settle = (code) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (killTimer !== undefined) {
        clearTimeout(killTimer)
      }
      signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr })
    }

    const onAbort = () => {
      killGroup()
      settle('ABORTED')
    }

    const timer = timeoutMs > 0
      ? setTimeout(() => {
        killGroup()
        settle('TIMEOUT')
      }, timeoutMs)
      : undefined

    if (signal?.aborted) {
      onAbort()
    } else {
      signal?.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk) => {
      stdout += chunk
      if (stdout.length > MAX_CAPTURE) {
        stdout = stdout.slice(-MAX_CAPTURE)
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk) => {
      stderr += chunk
      if (stderr.length > MAX_CAPTURE) {
        stderr = stderr.slice(-MAX_CAPTURE)
      }
    })

    child.on('error', (error) => {
      stderr += String(error?.message ?? error)
      settle('SPAWN_ERROR')
    })
    child.on('close', (code) => {
      settle(code ?? 0)
    })
  })
}

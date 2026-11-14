import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { createCommandDefinitions } from './commands.js'
import { prepareCodexBinDir } from './codex-path.js'
import { runCompanion } from './companion.js'
import { createCodexTaskTool } from './tool.js'

export const name = 'dsh-codex'
export const inject = ['commands', 'tools', 'workingDirectory']

const DEFAULTS = {
  codexPath: 'codex',
  model: '',
  effort: '',
  defaultBase: '',
  maxConcurrent: 2,
  timeoutMs: 30 * 60 * 1000,
  statusTimeoutMs: 15_000,
}

/**
 * @param {Record<string, unknown>} [config]
 * @returns {typeof DEFAULTS}
 */
export function normalizeSettings(config = {}) {
  const text = (value, fallback) => (typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback)
  const positive = (value, fallback) => (Number.isFinite(value) && value > 0 ? Math.floor(Number(value)) : fallback)

  return {
    codexPath: text(config.codexPath, DEFAULTS.codexPath),
    model: text(config.model, DEFAULTS.model),
    effort: text(config.effort, DEFAULTS.effort),
    defaultBase: text(config.defaultBase, DEFAULTS.defaultBase),
    maxConcurrent: positive(config.maxConcurrent, DEFAULTS.maxConcurrent),
    timeoutMs: positive(config.timeoutMs, DEFAULTS.timeoutMs),
    statusTimeoutMs: positive(config.statusTimeoutMs, DEFAULTS.statusTimeoutMs),
  }
}

/**
 * @returns {string} Plugin-owned data directory (also the engine's state root).
 */
export function resolveDataDir() {
  const home = process.env.DSH_HOME && process.env.DSH_HOME.trim().length > 0
    ? process.env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
  const dir = path.join(home, 'plugin-data', 'dsh-codex')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {Record<string, unknown>} [config]
 */
export function apply(ctx, config = {}) {
  const settings = normalizeSettings(config)
  const dataDir = resolveDataDir()
  const binDir = prepareCodexBinDir({ codexPath: settings.codexPath, dataDir })

  const run = (argv, options = {}) => runCompanion({
    argv,
    cwd: options.cwd,
    dataDir,
    sessionId: options.sessionId,
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? settings.timeoutMs,
    binDir,
  })

  const resolveCwd = (holder) => {
    try {
      const session = holder?.agent?.session
      const directory = ctx.workingDirectory.get(session)
      if (typeof directory === 'string' && directory.length > 0) {
        return directory
      }
    } catch {
      // fall through to the host's launch directory
    }
    return process.cwd()
  }

  ctx.effect(function* registerCodexSurface() {
    const disposers = []

    for (const definition of createCommandDefinitions({ run, resolveCwd, settings })) {
      disposers.push(ctx.commands.register(definition))
    }
    disposers.push(ctx.tools.register(createCodexTaskTool({ run, resolveCwd, settings })))

    yield () => {
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // already gone
        }
      }
    }
  })
}

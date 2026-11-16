/**
 * Translate a DSH command's raw text input into arguments for the vendored
 * `codex-companion.mjs` engine.
 *
 * Commands arrive as free text (`--base main 看下并发`), while the engine wants
 * a strict argv. Only flags the engine understands are extracted; anything
 * else stays part of the prompt so a user can mention `--weird` in prose.
 */

// The engine's review commands accept only these: an unrecognised `--effort`
// would be read as focus text, which native review then rejects.
const REVIEW_FLAGS = ['base', 'scope', 'model']
const TASK_FLAGS = ['resume', 'fresh', 'resume-last', 'write', 'model', 'effort']
const BOOLEAN_FLAGS = new Set(['resume', 'fresh', 'resume-last', 'write'])

/**
 * @param {string} raw
 * @param {string[]} [allowed]
 * @returns {{flags: Record<string, string | true>, positional: string[]}}
 */
export function splitFlags(raw, allowed = [...REVIEW_FLAGS, ...TASK_FLAGS]) {
  const allowedSet = new Set(allowed)
  const tokens = String(raw ?? '').trim().split(/\s+/u).filter(Boolean)
  /** @type {Record<string, string | true>} */
  const flags = {}
  /** @type {string[]} */
  const positional = []

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (!token.startsWith('--') || token.length === 2) {
      positional.push(token)
      continue
    }

    const equals = token.indexOf('=')
    const key = (equals > 0 ? token.slice(2, equals) : token.slice(2)).toLowerCase()
    if (!allowedSet.has(key)) {
      positional.push(token)
      continue
    }

    if (equals > 0) {
      flags[key] = token.slice(equals + 1)
      continue
    }
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true
      continue
    }

    const value = tokens[index + 1]
    if (value !== undefined && !value.startsWith('--')) {
      flags[key] = value
      index += 1
      continue
    }
    flags[key] = true
  }

  return { flags, positional }
}

/**
 * @param {string} kind `review` or `adversarial-review`
 * @param {string} raw
 * @param {{base?: string, model?: string}} defaults
 * @returns {{argv: string[], prompt: string}}
 */
export function buildReviewArgv(kind, raw, defaults = {}) {
  const { flags, positional } = splitFlags(raw, REVIEW_FLAGS)
  const argv = [kind]

  for (const [flag, fallback] of [
    ['base', defaults.base],
    ['scope', undefined],
    ['model', defaults.model],
  ]) {
    const value = typeof flags[flag] === 'string' ? flags[flag] : fallback
    if (typeof value === 'string' && value.length > 0) {
      argv.push(`--${flag}`, value)
    }
  }

  return { argv, prompt: positional.join(' ') }
}

/**
 * @param {string} raw
 * @param {{model?: string, effort?: string}} defaults
 * @returns {{argv: string[], prompt: string}}
 */
export function buildTaskArgv(raw, defaults = {}) {
  const { flags, positional } = splitFlags(raw, TASK_FLAGS)
  const argv = ['task']

  if (flags.resume === true) {
    argv.push('--resume')
  } else if (flags['resume-last'] === true) {
    argv.push('--resume-last')
  } else {
    argv.push('--fresh')
  }

  if (flags.write === true) {
    argv.push('--write')
  }

  const model = typeof flags.model === 'string' ? flags.model : defaults.model
  if (typeof model === 'string' && model.length > 0) {
    argv.push('--model', model)
  }
  const effort = typeof flags.effort === 'string' ? flags.effort : defaults.effort
  if (typeof effort === 'string' && effort.length > 0) {
    argv.push('--effort', effort)
  }

  return { argv, prompt: positional.join(' ') }
}

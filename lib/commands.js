import { buildReviewArgv, buildTaskArgv } from './args.js'
import { renderBackground, renderRun, renderSetup, tail } from './render.js'

const RESUME_FLAG = /(^|\s)--(?:resume|resume-last|fresh)(?=\s|$)/u
const FOLLOW_UP = /(继续|接着|再往下|接着改|深入|再查|keep going|continue|resume|dig deeper|apply the top fix)/iu
const DEFAULT_LAUNCH_TIMEOUT_MS = 120_000
const RESUME_LOOKUP_TIMEOUT_MS = 15_000

/**
 * Pull `--wait` / `--background` out of the raw input: they choose the
 * transport, so the engine must never see them.
 *
 * @param {string} rawInput
 * @returns {{wait: boolean, rest: string}}
 */
export function extractMode(rawInput) {
  const text = String(rawInput ?? '')
  const has = (flag) => new RegExp(`(^|\\s)--${flag}(?=\\s|$)`, 'u').test(text)
  const wait = has('wait')
  const rest = text
    .replace(/(^|\s)--(?:wait|background)(?=\s|$)/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return { wait: wait || false, rest }
}

/**
 * @param {import('@deepseek-ai/dsh-commands').CommandInvocation} invocation
 * @returns {string | undefined}
 */
function sessionIdOf(invocation) {
  const agent = invocation?.agent
  const id = agent?.session?.id ?? agent?.id
  return id === undefined ? undefined : String(id)
}

/**
 * Build the seven slash commands.
 *
 * @param {object} deps
 * @param {(argv: string[], options: {cwd: string, sessionId?: string, signal?: AbortSignal, timeoutMs?: number}) => Promise<import('./companion.js').CompanionResult>} deps.run
 * @param {(invocation: unknown) => string} deps.resolveCwd
 * @param {Record<string, any>} deps.settings
 * @returns {import('@deepseek-ai/dsh-commands').CommandDefinition[]}
 */
export function createCommandDefinitions(deps) {
  const { run, resolveCwd, settings } = deps
  const maxConcurrent = settings.maxConcurrent

  /**
   * @param {object} options
   * @param {string[]} options.argv
   * @param {string} options.label
   * @param {string | undefined} options.sessionId
   * @param {string} options.cwd
   * @param {AbortSignal | undefined} options.signal
   * @param {boolean} options.background
   */
  async function launch({ argv, label, sessionId, cwd, signal, background }) {
    if (!background) {
      return renderRun(await run(argv, { cwd, sessionId, signal, timeoutMs: settings.timeoutMs }), label)
    }

    const running = await countRunning({ cwd, sessionId, signal })
    if (running >= maxConcurrent) {
      return {
        kind: 'error',
        text: `已有 ${running} 个 Codex 任务在运行（上限 ${maxConcurrent}）。等它们结束，或用 \`/codex-cancel <id>\` 取消一个。`,
      }
    }

    const result = await run([...argv, '--background', '--json'], {
      cwd,
      sessionId,
      signal,
      timeoutMs: DEFAULT_LAUNCH_TIMEOUT_MS,
    })

    if (result.code !== 0) {
      return renderRun(result, label)
    }

    try {
      const payload = JSON.parse(result.stdout)
      if (typeof payload?.jobId === 'string' && payload.jobId.length > 0) {
        return { kind: 'success', text: renderBackground({ jobId: payload.jobId, title: payload.title }, label) }
      }
    } catch {
      // fall through to the raw output below
    }
    return { kind: 'success', text: tail(result.stdout) || `${label}已启动。` }
  }

  async function countRunning({ cwd, sessionId, signal }) {
    const result = await run(['status', '--json', '--timeout-ms', '1'], {
      cwd,
      sessionId,
      signal,
      timeoutMs: RESUME_LOOKUP_TIMEOUT_MS,
    })
    if (result.code !== 0) {
      return 0
    }
    try {
      const report = JSON.parse(result.stdout)
      return Array.isArray(report?.running) ? report.running.length : 0
    } catch {
      return 0
    }
  }

  async function resumeAvailable({ cwd, sessionId, signal }) {
    const result = await run(['task-resume-candidate', '--json'], {
      cwd,
      sessionId,
      signal,
      timeoutMs: RESUME_LOOKUP_TIMEOUT_MS,
    })
    if (result.code !== 0) {
      return false
    }
    try {
      return JSON.parse(result.stdout)?.available === true
    } catch {
      return false
    }
  }

  /** @type {import('@deepseek-ai/dsh-commands').CommandDefinition[]} */
  return [
    {
      name: 'codex-review',
      description: '用 Codex 审查当前 git 改动（原生 review，不修改代码）',
      input: { hint: '[--wait] [--base <ref>] [--scope auto|working-tree|branch]' },
      async handler(invocation) {
        const { wait, rest } = extractMode(invocation.rawInput)
        const { argv, prompt } = buildReviewArgv('review', rest, settings)
        if (prompt.length > 0) {
          return {
            kind: 'error',
            text: '原生 review 不接受额外审查指令。需要自定义关注点或对抗式审查，请用 `/codex-adversarial-review <关注点>`。',
          }
        }
        return launch({ argv, label: 'Codex Review', cwd: resolveCwd(invocation), sessionId: sessionIdOf(invocation), signal: invocation.signal, background: !wait })
      },
    },
    {
      name: 'codex-adversarial-review',
      description: '用 Codex 对抗式审查：质疑实现方案、设计取舍与隐含假设',
      input: { hint: '[--wait] [--base <ref>] [--scope …] [关注点 …]' },
      async handler(invocation) {
        const { wait, rest } = extractMode(invocation.rawInput)
        const { argv, prompt } = buildReviewArgv('adversarial-review', rest, settings)
        if (prompt.length > 0) {
          argv.push(prompt)
        }
        return launch({ argv, label: 'Codex 对抗式审查', cwd: resolveCwd(invocation), sessionId: sessionIdOf(invocation), signal: invocation.signal, background: !wait })
      },
    },
    {
      name: 'codex-rescue',
      description: '把调查、修复或续跑交给 Codex（会话内保持同一线程）',
      input: { hint: '[--wait] [--resume|--fresh] [--model …] [--effort …] <任务描述>' },
      async handler(invocation) {
        const { wait, rest } = extractMode(invocation.rawInput)
        const { argv, prompt } = buildTaskArgv(rest, settings)
        if (prompt.length === 0) {
          return { kind: 'error', text: '请描述要交给 Codex 的任务，例如 `/codex-rescue 修一下登录超时`。' }
        }
        argv.push(prompt)

        const cwd = resolveCwd(invocation)
        const sessionId = sessionIdOf(invocation)
        let hint = ''
        if (!RESUME_FLAG.test(rest)) {
          const available = await resumeAvailable({ cwd, sessionId, signal: invocation.signal })
          if (available) {
            if (FOLLOW_UP.test(prompt)) {
              argv.splice(1, 1, '--resume')
              hint = '\n\n（检测到同一会话里可续跑的 Codex 线程，已自动续跑；要新开线程加 `--fresh`。）'
            } else {
              hint = '\n\n（同一会话里有可续跑的 Codex 线程，要接着上次的改动加 `--resume`。）'
            }
          }
        }

        const result = await launch({ argv, label: 'Codex 任务', cwd, sessionId, signal: invocation.signal, background: !wait })
        return hint && result.kind === 'success' ? { ...result, text: result.text + hint } : result
      },
    },
    {
      name: 'codex-status',
      description: '查看本仓库的 Codex 任务进度',
      input: { hint: '[job-id] [--all]' },
      async handler(invocation) {
        const { rest } = extractMode(invocation.rawInput)
        const extra = rest.length > 0 ? rest.split(/\s+/u) : []
        const argv = ['status', ...extra, '--timeout-ms', String(settings.statusTimeoutMs)]
        return renderRun(await run(argv, { cwd: resolveCwd(invocation), sessionId: sessionIdOf(invocation), signal: invocation.signal, timeoutMs: settings.statusTimeoutMs + 10_000 }), '查询任务状态')
      },
    },
    {
      name: 'codex-result',
      description: '取出某个 Codex 任务的完整结果',
      input: { hint: '<job-id>' },
      async handler(invocation) {
        const jobId = extractMode(invocation.rawInput).rest.trim()
        if (jobId.length === 0) {
          return { kind: 'error', text: '需要任务 ID：`/codex-result <job-id>`。ID 来自 `/codex-status` 或启动任务时的提示。' }
        }
        return renderRun(await run(['result', jobId], { cwd: resolveCwd(invocation), sessionId: sessionIdOf(invocation), signal: invocation.signal, timeoutMs: 60_000 }), '读取结果')
      },
    },
    {
      name: 'codex-cancel',
      description: '取消一个正在运行的 Codex 任务',
      input: { hint: '<job-id>' },
      async handler(invocation) {
        const jobId = extractMode(invocation.rawInput).rest.trim()
        const argv = jobId.length > 0 ? ['cancel', jobId] : ['cancel']
        return renderRun(await run(argv, { cwd: resolveCwd(invocation), sessionId: sessionIdOf(invocation), signal: invocation.signal, timeoutMs: 60_000 }), '取消任务')
      },
    },
    {
      name: 'codex-setup',
      description: '检查 Codex CLI、登录状态与运行时',
      async handler(invocation) {
        const result = await run(['setup', '--json'], { cwd: resolveCwd(invocation), sessionId: sessionIdOf(invocation), signal: invocation.signal, timeoutMs: 60_000 })
        if (result.code !== 0) {
          return renderRun(result, '环境检查')
        }
        try {
          return renderSetup(JSON.parse(result.stdout))
        } catch {
          return { kind: 'success', text: tail(result.stdout) }
        }
      },
    },
  ]
}

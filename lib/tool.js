import { renderRun } from './render.js'

const DESCRIPTION = [
  '把一段需要自己跑代码、改文件或复现问题的任务交给本机 Codex CLI。',
  'Codex 在独立线程里工作，能用同一线程续跑；返回它的最终结论与改动摘要。',
  '适合：复现并定位问题、按描述实施修改、把一次探索沉淀成结论。',
  '不适合：只读的代码审查（用 /codex-review）、纯知识问答。',
].join('')

/**
 * @param {object} deps
 * @param {(argv: string[], options: {cwd: string, sessionId?: string, signal?: AbortSignal, timeoutMs?: number}) => Promise<import('./companion.js').CompanionResult>} deps.run
 * @param {(invocation: {agent?: unknown}) => string} deps.resolveCwd
 * @param {Record<string, any>} deps.settings
 * @returns {object} A registry-ready ToolDefinition.
 */
export function createCodexTaskTool(deps) {
  const { run, resolveCwd, settings } = deps

  return {
    name: 'codex_task',
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: '交给 Codex 的任务描述，写清目标与验收标准。',
        },
        resume: {
          type: 'boolean',
          description: '续跑本会话里最近的 Codex 线程，而不是新开一个。',
        },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          status: { type: 'number' },
          threadId: { type: 'string' },
          output: { type: 'string' },
        },
        required: ['status', 'threadId', 'output'],
        additionalProperties: false,
      },
      render(_args, value) {
        return [{ type: 'text', text: String(value?.output ?? '') }]
      },
    },
    timeoutMs: settings.timeoutMs,
    isConcurrencySafe: () => false,
    async execute(args, exec) {
      const prompt = typeof args?.prompt === 'string' ? args.prompt.trim() : ''
      if (prompt.length === 0) {
        throw new Error('codex_task 需要非空的 prompt。')
      }

      const argv = ['task', '--json', args?.resume === true ? '--resume' : '--fresh']
      if (typeof settings.model === 'string' && settings.model.length > 0) {
        argv.push('--model', settings.model)
      }
      if (typeof settings.effort === 'string' && settings.effort.length > 0) {
        argv.push('--effort', settings.effort)
      }
      argv.push(prompt)

      const result = await run(argv, {
        cwd: resolveCwd(exec),
        sessionId: exec?.agent?.session?.id === undefined ? undefined : String(exec.agent.session.id),
        signal: exec?.signal,
        timeoutMs: settings.timeoutMs,
      })

      if (result.code !== 0) {
        const failure = renderRun(result, 'Codex 任务')
        throw new Error(failure.text)
      }

      const payload = parseJson(result.stdout)
      const output = payload?.rawOutput ?? payload?.output ?? result.stdout.trim()
      return {
        status: typeof payload?.status === 'number' ? payload.status : 0,
        threadId: typeof payload?.threadId === 'string' ? payload.threadId : '',
        output: typeof output === 'string' && output.length > 0 ? output : 'Codex 已完成任务。',
      }
    },
  }
}

/**
 * @param {string} text
 * @returns {Record<string, any> | null}
 */
function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

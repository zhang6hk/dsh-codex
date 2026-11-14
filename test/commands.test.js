import assert from 'node:assert/strict'
import test from 'node:test'

import { createCommandDefinitions, extractMode } from '../lib/commands.js'
import { normalizeSettings } from '../lib/index.js'
import { createCodexTaskTool } from '../lib/tool.js'

const settings = normalizeSettings({ maxConcurrent: 2, timeoutMs: 1000, statusTimeoutMs: 500 })

function harness(overrides = {}) {
  /** @type {{argv: string[], options: Record<string, unknown>}[]} */
  const calls = []
  const run = async (argv, options) => {
    calls.push({ argv, options })
    if (argv[0] === 'status') {
      return { code: 0, stdout: JSON.stringify({ running: overrides.running ?? [] }) }
    }
    if (argv[0] === 'task-resume-candidate') {
      return { code: 0, stdout: JSON.stringify({ available: overrides.resumeAvailable === true }) }
    }
    if (argv.includes('--background')) {
      return { code: 0, stdout: JSON.stringify({ jobId: 'job-1', title: 'Codex Review' }) }
    }
    return { code: 0, stdout: 'done' }
  }
  const deps = { run, resolveCwd: () => '/repo', settings }
  return { calls, deps, definitions: createCommandDefinitions(deps) }
}

const invocation = (rawInput = '') => ({
  rawInput,
  agent: { id: 's1', session: { id: 's1' } },
  signal: undefined,
})

const find = (definitions, name) => definitions.find((definition) => definition.name === name)

test('registers the seven codex commands', () => {
  const { definitions } = harness()
  assert.deepEqual(definitions.map((definition) => definition.name), [
    'codex-review',
    'codex-adversarial-review',
    'codex-rescue',
    'codex-status',
    'codex-result',
    'codex-cancel',
    'codex-setup',
  ])
})

test('extractMode strips transport flags from the input', () => {
  assert.deepEqual(extractMode('--wait --base main 看一下'), { wait: true, rest: '--base main 看一下' })
  assert.deepEqual(extractMode('--background 修 bug'), { wait: false, rest: '修 bug' })
})

test('review always runs in the foreground and prints the engine report', async () => {
  const { calls, definitions } = harness()
  const result = await find(definitions, 'codex-review').handler(invocation('--base main'))

  assert.equal(result.kind, 'success')
  assert.match(result.text, /done/u)
  const review = calls.find((call) => call.argv[0] === 'review')
  assert.deepEqual(review.argv, ['review', '--base', 'main'])
  assert.equal(review.options.cwd, '/repo')
})

test('review honours --wait without changing the transport', async () => {
  const { calls, definitions } = harness()
  await find(definitions, 'codex-review').handler(invocation('--wait'))
  const review = calls.find((call) => call.argv[0] === 'review')
  assert.deepEqual(review.argv, ['review'])
})

test('native review refuses extra focus text', async () => {
  const { calls, definitions } = harness()
  const result = await find(definitions, 'codex-review').handler(invocation('顺便看看性能'))
  assert.equal(result.kind, 'error')
  assert.match(result.text, /adversarial-review/u)
  assert.equal(calls.length, 0)
})

test('adversarial review forwards focus text', async () => {
  const { calls, definitions } = harness()
  await find(definitions, 'codex-adversarial-review').handler(invocation('--scope branch 质疑缓存设计'))
  const call = calls.find((entry) => entry.argv[0] === 'adversarial-review')
  assert.deepEqual(call.argv, ['adversarial-review', '--scope', 'branch', '质疑缓存设计'])
})

test('background task launch is refused at the concurrency limit', async () => {
  const { definitions } = harness({ running: [{ id: 'a' }, { id: 'b' }] })
  const result = await find(definitions, 'codex-rescue').handler(invocation('修一下构建'))
  assert.equal(result.kind, 'error')
  assert.match(result.text, /上限 2/u)
})

test('rescue requires a task description', async () => {
  const { definitions } = harness()
  const result = await find(definitions, 'codex-rescue').handler(invocation(''))
  assert.equal(result.kind, 'error')
  assert.match(result.text, /请描述/u)
})

test('rescue resumes the thread for follow-up wording', async () => {
  const { calls, definitions } = harness({ resumeAvailable: true })
  await find(definitions, 'codex-rescue').handler(invocation('继续把剩下的修完'))
  const call = calls.find((entry) => entry.argv[0] === 'task')
  assert.equal(call.argv.includes('--resume'), true)
  assert.equal(call.argv.includes('--fresh'), false)
})

test('rescue hints about resuming when starting fresh with a live thread', async () => {
  const { calls, definitions } = harness({ resumeAvailable: true })
  const result = await find(definitions, 'codex-rescue').handler(invocation('查一下构建为什么慢'))
  const call = calls.find((entry) => entry.argv[0] === 'task')
  assert.equal(call.argv.includes('--fresh'), true)
  assert.match(result.text, /--resume/u)
})

test('status forwards flags and a bounded wait', async () => {
  const { calls, definitions } = harness()
  await find(definitions, 'codex-status').handler(invocation('--all'))
  const call = calls.find((entry) => entry.argv[0] === 'status')
  assert.deepEqual(call.argv, ['status', '--all', '--timeout-ms', '500'])
})

test('result without an id explains the required argument', async () => {
  const { definitions } = harness()
  const result = await find(definitions, 'codex-result').handler(invocation(''))
  assert.equal(result.kind, 'error')
  assert.match(result.text, /job-id/u)
})

test('setup renders a readable readiness report', async () => {
  const { definitions } = harness()
  const definition = find(definitions, 'codex-setup')
  const deps = {
    run: async () => ({
      code: 0,
      stdout: JSON.stringify({
        ready: true,
        node: { available: true, detail: 'v26.7.0' },
        npm: { available: true, detail: '11.19.0' },
        codex: { available: true, detail: 'codex-cli 0.166.0' },
        auth: { available: true, loggedIn: true, detail: 'ChatGPT login active' },
        sessionRuntime: { mode: 'direct', label: 'direct startup' },
      }),
    }),
    resolveCwd: () => '/repo',
    settings,
  }
  const result = await createCommandDefinitions(deps).find((entry) => entry.name === 'codex-setup').handler(invocation(''))
  assert.equal(result.kind, 'success')
  assert.match(result.text, /就绪/u)
  assert.match(result.text, /codex-cli 0\.166\.0/u)
  assert.equal(definition.name, 'codex-setup')
})

test('codex_task runs a fresh thread and returns the engine payload', async () => {
  const calls = []
  const tool = createCodexTaskTool({
    run: async (argv, options) => {
      calls.push({ argv, options })
      return { code: 0, stdout: JSON.stringify({ status: 0, threadId: 't-9', rawOutput: '改好了' }) }
    },
    resolveCwd: () => '/repo',
    settings,
  })

  const value = await tool.execute({ prompt: '修登录' }, { agent: { session: { id: 's1' } }, signal: undefined })
  assert.deepEqual(calls[0].argv, ['task', '--json', '--fresh', '修登录'])
  assert.equal(calls[0].options.sessionId, 's1')
  assert.deepEqual(value, { status: 0, threadId: 't-9', output: '改好了' })
  assert.deepEqual(tool.output.render({}, value), [{ type: 'text', text: '改好了' }])
})

test('codex_task surfaces engine failure as an error', async () => {
  const tool = createCodexTaskTool({
    run: async () => ({ code: 1, stdout: '', stderr: 'fatal: not a git repository' }),
    resolveCwd: () => '/repo',
    settings,
  })
  await assert.rejects(tool.execute({ prompt: 'x' }, { signal: undefined }), /不是 git 仓库/u)
})

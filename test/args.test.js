import assert from 'node:assert/strict'
import test from 'node:test'

import { buildReviewArgv, buildTaskArgv, splitFlags } from '../lib/args.js'

test('splits known flags from prompt text', () => {
  const { flags, positional } = splitFlags('--base main --scope branch 看一下并发问题')
  assert.deepEqual(flags, { base: 'main', scope: 'branch' })
  assert.deepEqual(positional, ['看一下并发问题'])
})

test('supports --flag=value form', () => {
  const { flags } = splitFlags('--model=gpt-5.6-codex --effort high 修 bug')
  assert.equal(flags.model, 'gpt-5.6-codex')
  assert.equal(flags.effort, 'high')
})

test('keeps unknown flags as prompt text', () => {
  const { flags, positional } = splitFlags('--unknown value hi')
  assert.deepEqual(flags, {})
  assert.deepEqual(positional, ['--unknown', 'value', 'hi'])
})

test('review argv carries base and focus text', () => {
  const { argv, prompt } = buildReviewArgv('review', '--base main 关注错误处理', {})
  assert.deepEqual(argv, ['review', '--base', 'main'])
  assert.equal(prompt, '关注错误处理')
})

test('review argv falls back to configured base', () => {
  const { argv } = buildReviewArgv('adversarial-review', '', { base: 'develop' })
  assert.deepEqual(argv, ['adversarial-review', '--base', 'develop'])
})

test('review argv never carries reasoning effort', () => {
  const { argv } = buildReviewArgv('review', '', { model: 'gpt-6.1-sol', effort: 'medium' })
  assert.deepEqual(argv, ['review', '--model', 'gpt-6.1-sol'])
})

test('review argv drops unsupported flags', () => {
  const { argv, prompt } = buildReviewArgv('review', '--write 看一下', {})
  assert.deepEqual(argv, ['review'])
  assert.equal(prompt, '--write 看一下')
})

test('task argv defaults to a fresh thread', () => {
  const { argv, prompt } = buildTaskArgv('修一下登录', {})
  assert.deepEqual(argv, ['task', '--fresh'])
  assert.equal(prompt, '修一下登录')
})

test('task argv honours resume and model defaults', () => {
  const { argv } = buildTaskArgv('--resume 继续', { model: 'spark', effort: 'high' })
  assert.deepEqual(argv, ['task', '--resume', '--model', 'spark', '--effort', 'high'])
})

test('task argv does not stack resume modes', () => {
  const { argv } = buildTaskArgv('--resume-last 继续', {})
  assert.deepEqual(argv, ['task', '--resume-last'])
})

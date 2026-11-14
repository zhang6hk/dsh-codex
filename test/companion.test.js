import assert from 'node:assert/strict'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { augmentPath, runCompanion } from '../lib/companion.js'

const fixture = fileURLToPath(new URL('./fixtures/fake-companion.mjs', import.meta.url))
const cwd = dirname(fileURLToPath(import.meta.url))

test('passes argv, cwd and plugin data dir to the engine', async () => {
  const result = await runCompanion({
    argv: ['review', '--base', 'main'],
    cwd,
    dataDir: '/tmp/dsh-codex-data',
    companionPath: fixture,
    timeoutMs: 10_000,
  })

  assert.equal(result.code, 0, result.stderr)
  const payload = JSON.parse(result.stdout)
  assert.deepEqual(payload.args, ['review', '--base', 'main'])
  assert.equal(payload.cwd, cwd)
  assert.equal(payload.dataDir, '/tmp/dsh-codex-data')
})

test('reports the engine exit code and stderr', async () => {
  const result = await runCompanion({ argv: ['--fail'], cwd, dataDir: '/tmp/x', companionPath: fixture })
  assert.equal(result.code, 2)
  assert.match(result.stderr, /engine rejected the request/u)
})

test('kills a runaway engine and reports TIMEOUT', async () => {
  const startedAt = Date.now()
  const result = await runCompanion({ argv: ['--sleep'], cwd, dataDir: '/tmp/x', companionPath: fixture, timeoutMs: 100 })
  assert.equal(result.code, 'TIMEOUT')
  assert.ok(Date.now() - startedAt < 3000, 'timeout must not wait for the engine to finish')
})

test('aborts on the caller signal', async () => {
  const controller = new AbortController()
  const pending = runCompanion({
    argv: ['--sleep'],
    cwd,
    dataDir: '/tmp/x',
    companionPath: fixture,
    signal: controller.signal,
    timeoutMs: 10_000,
  })
  setTimeout(() => controller.abort(), 50)
  const result = await pending
  assert.equal(result.code, 'ABORTED')
})

test('adds GUI-invisible package managers to PATH', () => {
  const env = augmentPath({ PATH: '/usr/bin:/bin' }, '/Users/someone')
  const parts = env.PATH.split(':')
  assert.ok(parts.includes('/opt/homebrew/bin'))
  assert.ok(parts.includes('/usr/local/bin'))
  assert.ok(parts.includes('/Users/someone/.local/bin'))
  assert.equal(parts.at(-1), '/bin')
})

test('does not duplicate PATH entries', () => {
  const env = augmentPath({ PATH: '/opt/homebrew/bin:/usr/bin' }, '/Users/someone')
  assert.equal(env.PATH.split(':').filter((entry) => entry === '/opt/homebrew/bin').length, 1)
})

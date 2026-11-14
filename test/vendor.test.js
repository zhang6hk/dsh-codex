import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const companion = fileURLToPath(new URL('../vendor/codex/scripts/codex-companion.mjs', import.meta.url))

test('vendored engine runs without a Claude environment', () => {
  const result = spawnSync(process.execPath, [companion, 'help'], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME },
  })
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /adversarial-review/u)
  assert.match(result.stdout, /codex-companion\.mjs status/u)
  assert.equal(result.stdout.includes('CLAUDE_PLUGIN_ROOT'), false)
})

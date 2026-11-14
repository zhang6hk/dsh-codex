import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(fs.readFileSync(new URL('package.json', `file://${root}`), 'utf8'))

test('declares a bundle patch for the plugin manager', () => {
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(fs.existsSync(new URL('cordis.patch.yml', `file://${root}`)))
})

test('ships the vendored engine and the plugin entry', () => {
  assert.ok(manifest.files.includes('vendor'))
  assert.ok(manifest.files.includes('lib'))
  assert.ok(fs.existsSync(new URL('vendor/codex/scripts/codex-companion.mjs', `file://${root}`)))
  assert.ok(fs.existsSync(new URL('vendor/codex/.claude-plugin/plugin.json', `file://${root}`)))
  assert.ok(fs.existsSync(new URL('lib/index.js', `file://${root}`)))
})

test('stays a zero-dependency host plugin', () => {
  assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [])
})

test('the patch mounts this package', () => {
  const patch = fs.readFileSync(new URL('cordis.patch.yml', `file://${root}`), 'utf8')
  assert.match(patch, new RegExp(manifest.name.replaceAll('/', '\\/').replaceAll('@', '@'), 'u'))
})

test('locale metadata exists for both languages', () => {
  for (const language of ['en', 'zh']) {
    const locale = JSON.parse(fs.readFileSync(new URL(`locale/${language}.json`, `file://${root}`), 'utf8'))
    assert.ok(locale.meta.title.length > 0)
    assert.ok(locale.meta.description.length > 0)
  }
})

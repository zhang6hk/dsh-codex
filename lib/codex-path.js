import fs from 'node:fs'
import path from 'node:path'

/**
 * The engine always spawns a binary literally named `codex`. When the user
 * configures a different absolute path, expose it as `codex` through a private
 * bin directory prepended to PATH — no engine patch needed.
 *
 * @param {{codexPath?: string, dataDir: string}} options
 * @returns {string | null} Directory to prepend to PATH, if any.
 */
export function prepareCodexBinDir({ codexPath, dataDir }) {
  const value = String(codexPath ?? '').trim()
  if (value.length === 0 || value === 'codex' || !path.isAbsolute(value)) {
    return null
  }

  const binDir = path.join(dataDir, 'bin')
  fs.mkdirSync(binDir, { recursive: true })
  const link = path.join(binDir, 'codex')
  try {
    if (fs.readlinkSync(link) === value) {
      return binDir
    }
    fs.unlinkSync(link)
  } catch {
    // no existing link
  }
  fs.symlinkSync(value, link)
  return binDir
}

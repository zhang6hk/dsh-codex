/**
 * User-facing text for command results. Kept apart from the command wiring so
 * the wording can be reviewed (and translated) without touching behavior.
 */

const TAIL_LIMIT = 4000

/**
 * @param {string} text
 * @param {number} [limit]
 * @returns {string}
 */
export function tail(text, limit = TAIL_LIMIT) {
  const value = String(text ?? '').trim()
  if (value.length <= limit) {
    return value
  }
  return `…${value.slice(-limit)}`
}

/**
 * @param {{jobId: string, title?: string}} payload
 * @param {string} label Human name for the work, e.g. `Codex Review`.
 * @returns {string}
 */
export function renderBackground(payload, label) {
  const title = payload.title ? `${label}（${payload.title}）` : label
  return [
    `${title}已在后台启动，不会阻塞当前会话。`,
    '',
    `- 任务 ID：${payload.jobId}`,
    `- 查看进度：/codex-status ${payload.jobId}`,
    `- 查看结果：/codex-result ${payload.jobId}`,
    `- 取消任务：/codex-cancel ${payload.jobId}`,
  ].join('\n')
}

/**
 * @param {string} text
 * @returns {string | null} A concrete next step when the engine failed.
 */
function hintFor(text) {
  if (/not a git repository|fatal: not a git/iu.test(text)) {
    return '当前目录不是 git 仓库。`/codex-review` 只能审查 git 工作区，请先 `git init` 或在仓库内调用。'
  }
  if (/codex(?:-cli)?[^\n]*(?:not found|ENOENT)|spawn codex ENOENT/iu.test(text)) {
    return '找不到 `codex` 可执行文件。安装：`npm install -g @openai/codex`；若装在非标准位置，在 `cordis.patch.yml` 里把 `codexPath` 指向它的绝对路径。'
  }
  if (/not logged in|login|unauthorized|401/iu.test(text)) {
    return 'Codex 未登录。先在终端运行 `codex login`，再执行 `/codex-setup` 确认状态。'
  }
  return null
}

/**
 * Normalize one engine run into a command result.
 *
 * @param {{code: number | string, stdout: string, stderr: string}} result
 * @param {string} what Human name of the failed operation.
 * @returns {{kind: 'success' | 'error', text: string}}
 */
export function renderRun(result, what) {
  if (result.code === 0) {
    return { kind: 'success', text: result.stdout.trim() || `${what}已完成。` }
  }
  if (result.code === 'TIMEOUT') {
    return { kind: 'error', text: `${what}超时。Codex 可能仍在运行，用 \`/codex-status\` 查看任务，或调大 \`timeoutMs\`。` }
  }
  if (result.code === 'ABORTED') {
    return { kind: 'error', text: `${what}已取消。` }
  }
  if (result.code === 'SPAWN_ERROR') {
    return { kind: 'error', text: `${what}无法启动：${tail(result.stderr) || '未能启动 Node 子进程。'}` }
  }

  const combined = [result.stderr, result.stdout].filter(Boolean).join('\n')
  const hint = hintFor(combined)
  const detail = tail(combined) || `退出码 ${result.code}`
  return { kind: 'error', text: hint ? `${hint}\n\n${detail}` : `${what}失败：\n${detail}` }
}

/**
 * @param {Record<string, any>} report Parsed `setup --json` payload.
 * @returns {{kind: 'success' | 'error', text: string}}
 */
export function renderSetup(report) {
  const line = (label, entry) => {
    const ok = entry?.available !== false
    const detail = entry?.detail ? `：${entry.detail}` : ''
    return `- ${label}：${ok ? '正常' : '不可用'}${detail}`
  }

  const auth = report?.auth
  const authLine = auth
    ? `- 登录：${auth.loggedIn ? `已登录${auth.detail ? `（${auth.detail}）` : ''}` : '未登录'}`
    : '- 登录：未知'

  const runtime = report?.sessionRuntime
  const lines = [
    `Codex 环境检查：${report?.ready ? '就绪' : '未就绪'}`,
    '',
    line('Node', report?.node),
    line('npm', report?.npm),
    line('Codex', report?.codex),
    authLine,
    runtime ? `- 会话运行时：${runtime.label ?? runtime.mode}${runtime.detail ? `（${runtime.detail}）` : ''}` : '',
  ].filter(Boolean)

  if (!report?.ready) {
    lines.push('', '修复建议：安装 Codex（`npm install -g @openai/codex`）并运行 `codex login`。')
  }

  return { kind: report?.ready ? 'success' : 'error', text: lines.join('\n') }
}

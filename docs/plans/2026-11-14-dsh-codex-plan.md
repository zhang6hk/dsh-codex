# dsh-codex 实施计划

> **For agentic workers:** 逐任务执行，每个任务结束跑测试并提交。步骤用 `- [ ]` 跟踪。

**Goal:** 把 codex-plugin-cc 的 review / adversarial-review / rescue / status / result / cancel / setup 以 DSH bundle 形式交付，可 `dsh plugin add github:zhang6hk/dsh-codex` 安装。

**Architecture:** 零依赖 ESM 插件，`lib/index.js` 注册 7 条命令 + `codex_task` 工具，全部转发给 vendor 进包内的上游 `codex-companion.mjs` 子进程；子进程 cwd 取会话工作目录，注入 `CLAUDE_PLUGIN_DATA` 指向插件数据目录。

**Tech Stack:** Node.js ≥ 22 ESM、`node:test`、Cordis 插件 API（`commands` / `tools` / `workingDirectory`）、上游 Codex app-server 引擎。

**Spec:** `docs/plans/2026-11-14-dsh-codex-design.md`

## Global Constraints

- 命令名匹配 `/^[a-z][a-z0-9_-]*$/u`，不得含冒号。
- 运行时零 npm 依赖；`dependencies` 必须为空对象。
- `package.json` 必须含 `dsh.bundle.patch`，同目录必须有 `cordis.patch.yml`。
- 不得修改 `vendor/codex/**` 下任何文件。
- 保留上游 `LICENSE`、`NOTICE`；整仓 Apache-2.0。
- 所有面向用户的文案中文优先（README 双语）。

## Review Focus

- 用户机器上 `codex` 不在 GUI 进程 PATH 中 → 必须给出可操作提示而不是 `ENOENT` 栈。
- 非 git 目录执行 review → 引擎报错，插件应转成一句人话。
- 后台任务被反复启动 → 并发上限必须拒绝而非静默排队。
- 子进程被取消（用户中断回合）→ 必须 kill 进程树，不能留孤儿 codex。
- 引擎输出超长（review 可能几万字符）→ 必须截断尾部并保留 `jobId` 供后续 `result`。

---

### Task 1: 仓库骨架与引擎 vendor

**Files:**
- Create: `package.json`、`cordis.patch.yml`、`LICENSE`、`NOTICE`、`README.md`、`README.zh.md`、`.gitignore`、`test/vendor.test.js`
- Create: `vendor/codex/**`（从 `/tmp/codex-plugin-cc/plugins/codex/` 复制 `scripts`、`schemas`、`prompts`、`.claude-plugin`）

**Interfaces:**
- Produces: `vendor/codex/scripts/codex-companion.mjs`（可执行）、`vendor/codex/.claude-plugin/plugin.json`。

- [ ] **Step 1: 写 vendor 冒烟测试** —— `test/vendor.test.js`：spawn `node vendor/codex/scripts/codex-companion.mjs help`，断言 stdout 含 `adversarial-review`，退出码 0。
- [ ] **Step 2: 跑测试确认失败**（文件不存在）。
- [ ] **Step 3: 复制 vendor 目录并写骨架文件。**
- [ ] **Step 4: 跑 `node --test test/`，确认通过。**
- [ ] **Step 5: commit `chore: scaffold repo and vendor codex engine`。**

### Task 2: 参数解析

**Files:**
- Create: `lib/args.js`、`test/args.test.js`

**Interfaces:**
- Produces: `parseReviewInput(raw: string, defaults: {base?: string, model?: string, effort?: string}) -> {argv: string[], prompt: string}`；`parseTaskInput(raw, defaults) -> {argv: string[], prompt: string, write: boolean}`；`splitFlags(raw) -> {positional: string[], flags: {base?:string, scope?:string, model?:string, effort?:string, background?:boolean}}`。

- [ ] **Step 1: 写失败测试** —— 断言 `--base main --scope branch 看一下` → `{base:'main', scope:'branch'}` 且 prompt 为 `看一下`；未知 `--foo` 原样留在 positional；prompt 含空格不拆分。
- [ ] **Step 2: 跑测试确认失败。**
- [ ] **Step 3: 实现三个函数。**
- [ ] **Step 4: 跑测试确认通过；commit `feat: parse command input into engine argv`。**

### Task 3: 子进程封装

**Files:**
- Create: `lib/companion.js`、`lib/codex-path.js`、`test/companion.test.js`、`test/fixtures/fake-companion.mjs`

**Interfaces:**
- Produces: `resolveCodexEnv(env, config) -> env`（追加 `/opt/homebrew/bin`、`/usr/local/bin`、`~/.local/bin`）；`runCompanion({argv, cwd, dataDir, env, timeoutMs, signal, companionPath}) -> {code, stdout, stderr}`；`spawnCompanion(...)` 返回 `{child, done}`。
- `fake-companion.mjs`：把 `process.argv.slice(2)`、`process.cwd()`、`process.env.CLAUDE_PLUGIN_DATA` 打成 JSON 到 stdout。

- [ ] **Step 1: 写失败测试** —— `runCompanion` 用 fixture 断言 argv/cwd/env 透传；`timeoutMs: 50` 时对 `setTimeout` 节点返回 `code: 'TIMEOUT'`；`signal` abort 时同样终止。
- [ ] **Step 2: 跑测试确认失败。**
- [ ] **Step 3: 实现。** 超时/取消用 `terminate()` + 3 秒后 `SIGKILL` 兜底；stdout/stderr 各截断保留末 64KB。
- [ ] **Step 4: 跑测试确认通过；commit `feat: spawn vendored companion with env and timeout`。**

### Task 4: 命令注册

**Files:**
- Create: `lib/index.js`、`lib/commands.js`、`lib/render.js`、`test/commands.test.js`

**Interfaces:**
- Produces: `registerCommands(ctx, deps)`，`deps = {run, resolveCwd, config}`；`renderBackground(payload) -> string`（`Codex Review 已在后台启动，任务 ID：<jobId>。用 /codex-status <jobId> 查看进度。`）。
- 每条命令 `handler(invocation)` 返回 `{kind:'success'|'error', text}`。

- [ ] **Step 1: 写失败测试** —— 伪 ctx 捕获 `commands.register` 的 definition，断言注册了 7 个名字；调用 `codex-status` handler 时 `run` 收到 `['status']`；`codex-review` 默认带 `--background --json`，且 render 文本含 jobId。
- [ ] **Step 2: 跑测试确认失败。**
- [ ] **Step 3: 实现 7 条命令。** setup 用 `--json` 并重排为中文报告（去掉 `/codex:` 字样）。
- [ ] **Step 4: 跑测试确认通过；commit `feat: register seven codex commands`。**

### Task 5: `codex_task` 工具

**Files:**
- Create: `lib/tool.js`、`test/tool.test.js`

**Interfaces:**
- Produces: `codexTaskTool(deps)` 返回 `defineTool` 配置：`name: 'codex_task'`，参数 `{prompt, resume?, model?, effort?}`，`output.schema` 为 `{type:'object',properties:{status,threadId,output},required:[...]}`。

- [ ] **Step 1: 写失败测试** —— 断言 `execute({prompt:'hi'})` 调 `run` 收到 `['task','--json','hi']`，返回值含 `threadId`。
- [ ] **Step 2: 跑测试确认失败。**
- [ ] **Step 3: 实现；`--resume` 时加 `--resume`，否则 `--fresh`。**
- [ ] **Step 4: 跑测试确认通过；commit `feat: add codex_task tool`。**

### Task 6: 打包元数据与安装验证

**Files:**
- Modify: `package.json`、`cordis.patch.yml`
- Create: `locale/en.json`、`locale/zh.json`

- [ ] **Step 1: 写测试** —— `test/package.test.js` 断言 `package.json` 有 `dsh.bundle.patch`、`dependencies` 为空、`files` 含 `vendor`；`cordis.patch.yml` 与包名一致。
- [ ] **Step 2: 实现元数据与 locale。**
- [ ] **Step 3: 本地安装**：`plugin_manager install_bundle` 指向本目录，确认加载成功。
- [ ] **Step 4: 端到端**：在 `/Users/jasonzhang/workspace/dsh-codex` 本身执行 `/codex-setup`，确认 `ready: true`；再在一个有改动的仓库跑 `/codex-review --wait`。
- [ ] **Step 5: commit `chore: add bundle metadata and locale`。**

### Task 7: 发布

- [ ] **Step 1:** `git remote add origin git@github-personal:zhang6hk/dsh-codex.git && git push -u origin main`
- [ ] **Step 2:** 加 topic `dsh-plugin`。
- [ ] **Step 3:** 用户登录 npm 后 `npm publish --access public`。
- [ ] **Step 4:** 向 `awesome-dsh-plugin` 提 `data/plugins/zhang6hk__dsh-codex.yml`。
- [ ] **Step 5:** 验证 `dsh plugin add github:zhang6hk/dsh-codex` 与 `dsh plugin add @zhang6hk/dsh-codex`。

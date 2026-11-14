# dsh-codex 设计文档

日期：2026-11-14
状态：已确认（用户选择「完整 1:1」+「codex_task 工具」）
上游：https://github.com/openai/codex-plugin-cc （Apache-2.0）

## 目标

把 `codex-plugin-cc` 的代码审查与任务委派能力搬进 DSH，以标准 bundle 形式发布，支持：

1. `dsh plugin add github:zhang6hk/dsh-codex`
2. `dsh plugin add @zhang6hk/dsh-codex`
3. 进入 dsh-market 目录，GUI 一键安装

## 非目标

- `/codex:transfer`（读取 `~/.claude/projects`，DSH 无对应概念）
- Stop 审查闸门（`hooks/hooks.json`；DSH 无 shell hooks 机制）
- 跨会话把 Claude 对话导入 Codex

## 架构

```
DSH Host 进程
└── dsh-codex 插件（lib/index.js，零依赖 ESM）
    ├── 7 个命令 → 参数解析 → spawn codex-companion.mjs
    ├── 1 个工具 codex_task → 同一封装，返回结构化 JSON
    └── vendor/codex/  上游引擎原样放置
```

### 为什么 vendor 原样

上游引擎 4780 行，Claude 耦合只有 4 处，且都能在外层消解：

| 耦合 | 消解方式 |
|---|---|
| `CLAUDE_PLUGIN_DATA` | 插件 spawn 子进程时注入 `CLAUDE_PLUGIN_DATA=<DSH 数据目录>`；`lib/state.mjs` 本来就有该环境变量优先级 |
| `../../.claude-plugin/plugin.json` | vendor 时保留该文件（仅 version/name 元信息） |
| `CLAUDE_PROJECT_DIR` / `CLAUDE_ENV_FILE` | 只在 hooks 里使用，hooks 不 vendor |
| `~/.claude/projects` | 只在 transfer 里使用，transfer 不注册 |

因此**引擎零改动**，后续 `git subtree pull` 可无损跟进上游。

### 为什么不用 TypeScript 构建

- 插件是 Host-only、零运行时依赖，唯一外部程序是 `codex`。
- 发布 TS 需要 `typescript` + `@deepseek-ai/*` 类型包，安装期多一层解析风险。
- 结论：`lib/*.js` 直接作为源码与产物，`node --test` 跑单测。

## 命令契约

命令名由 `dsh-commands` 校验：`/^[a-z][a-z0-9_-]*$/u`，冒号非法，故全部改为连字符。

| 命令 | 引擎调用 | 说明 |
|---|---|---|
| `/codex-review [focus]` | `review [--wait] [--base] [--scope] [--model] [--effort]` | 默认后台 |
| `/codex-adversarial-review [focus]` | `adversarial-review ...` | 同上 |
| `/codex-rescue <prompt>` | `task [--resume\|--fresh\|--resume-last] [--model] [--effort]` | 默认后台 |
| `/codex-status [job-id] [--all]` | `status ...` | 前台，输出原样 |
| `/codex-result <job-id>` | `result <id>` | 前台 |
| `/codex-cancel <job-id>` | `cancel <id>` | 前台 |
| `/codex-setup` | `setup --json` | 前台，重排为 DSH 文案 |

后台启动统一用 `--json` 取 `{jobId, title}`，再渲染成 DSH 自己的提示（把 `/codex:status` 换成 `/codex-status`）。

## 工具契约

`codex_task`：模型侧调用，对应原版 `codex-rescue` 子代理。

参数：`prompt`（必填）、`resume`（bool）、`model`、`effort`。
输出：`{ status, threadId, output }`，`render` 成一段文本。
`isConcurrencySafe` 返回 false（都写同一个 Codex 线程池）。

## 工作目录

DSH 的 Host 进程 cwd 不是会话工作区，不能直接用 `process.cwd()`。
取 `ctx.workingDirectory.get(invocation.agent.session)`；服务缺失时回落 `process.cwd()`。

## 可执行文件发现

macOS 上 GUI 应用的 PATH 通常只有 `/usr/bin:/bin:/usr/sbin:/sbin`，直接 spawn `codex` 会 ENOENT。策略：

1. 配置了 `codexPath` 就用它；
2. 否则按 `codex` 在增强 PATH 中查找：`/opt/homebrew/bin:/usr/local/bin:${HOME}/.local/bin` + 原 PATH；
3. 找不到时给出可操作的中文错误，提示安装命令与配置项。

## 状态与并发

- 状态目录：`$DSH_HOME/plugin-data/dsh-codex`（由 `@deepseek-ai/dsh-home-paths` 解析，缺省 `~/.dsh`）。
- 引擎自身的 `state.json` + `jobs/` 继续使用，不另造 job store。
- 并发上限 `maxConcurrent`（默认 2）：启动新任务前读取引擎 `status --json`，达到上限直接拒绝，不做排队。

## 配置

`cordis.patch.yml` 的 `config`：

| 键 | 默认 | 说明 |
|---|---|---|
| `codexPath` | `codex` | Codex 可执行文件 |
| `model` | 空 | 透传 `--model` |
| `effort` | 空 | 透传 `--effort` |
| `defaultBase` | 空 | `/codex-review` 的默认 `--base` |
| `maxConcurrent` | `2` | 并发任务上限 |

## 错误处理

| 情形 | 表现 |
|---|---|
| codex 未安装 | 提示安装命令 + `codexPath` 配置项 |
| codex 未登录 | 提示执行 `codex login`，并建议先跑 `/codex-setup` |
| 非 git 仓库 | 提示 `/codex-review` 需要 git 工作区 |
| 子进程超时 | 默认 30 分钟；超时 kill 进程树并返回 `error` |
| 引擎非零退出 | 透出 stderr 尾部（截断 4KB），不吞错误 |

## 测试

- 单元：参数解析、PATH 发现、JSON→文本渲染、错误归一（`node --test`）。
- 集成：本地 `plugin_manager.install_bundle` 装本目录 → `/codex-setup` → 真实仓库跑一次 `/codex-review --wait`。
- 回放：重启 GUI 后命令仍在且可执行。

## 分发

1. GitHub：`zhang6hk/dsh-codex`，topic `dsh-plugin`。
2. npm：`@zhang6hk/dsh-codex`（`dsh-codex` 已被占用）。
3. 市场：PR 到 `awesome-dsh-plugin/awesome-dsh-plugin`，新增 `data/plugins/zhang6hk__dsh-codex.yml`，`category: git`。

## 许可

整仓 Apache-2.0，保留上游 `LICENSE` 与 `NOTICE`，README 声明派生关系。

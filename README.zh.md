# dsh-codex

把 [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) 的能力搬进 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)：让本机 Codex CLI 审查你的改动，或直接把调查/修复任务交给它。

## 安装

```bash
# 从 GitHub 直接装
dsh plugin add github:zhang6hk/dsh-codex

# 或从 npm（@zhang6hk scope）
dsh plugin add @zhang6hk/dsh-codex
```

桌面端：Plugins → Add plugin，粘贴上面的 spec。

装完重启会话，输入 `/codex-setup` 确认 Codex 就绪。

## 前置条件

- [Codex CLI](https://github.com/openai/codex)：`npm install -g @openai/codex`
- 已登录：`codex login`（ChatGPT 账号或 API key 均可）
- Node.js ≥ 22（DSH 自带运行时即可）

## 命令

| 命令 | 作用 |
|---|---|
| `/codex-review` | 审查当前 git 改动（原生 review，不修改代码） |
| `/codex-adversarial-review <关注点>` | 对抗式审查：质疑方案、取舍与假设 |
| `/codex-rescue <任务>` | 把调查/修复交给 Codex，保持同一线程 |
| `/codex-status [job-id]` | 查看任务进度 |
| `/codex-result <job-id>` | 取回完整结果 |
| `/codex-cancel <job-id>` | 取消任务 |
| `/codex-setup` | 检查 CLI、登录与运行时 |

审查类命令在前台运行，Codex 直接在会话里输出审查结论（上游引擎的 review 没有后台模式）。`/codex-rescue` 默认后台执行并返回任务 ID。常用参数：`--base <ref>`、`--scope auto|working-tree|branch`、`--model`、`--effort`。

除命令外还有一个 `codex_task` 工具，模型可以在对话里自行调用它把任务转给 Codex。

## 配置

在 `cordis.patch.yml` 的 `config` 里改：

```yaml
- insert:
    - id: dsh-codex
      name: '@zhang6hk/dsh-codex'
      config:
        codexPath: codex       # Codex 可执行文件；非标准位置填绝对路径
        model: ''              # 默认模型，透传 --model
        effort: ''             # 默认推理力度，透传 --effort
        defaultBase: ''        # 默认审查基线，如 origin/main
        maxConcurrent: 2       # 同时运行的 Codex 任务上限
        timeoutMs: 1800000     # 单次任务超时（30 分钟）
```

## 和原版有什么不同

原版是 Claude Code 插件，DSH 没有斜杠命令文件、shell hooks 和 markdown 子代理，所以移植方式不同：

- **命令名去掉冒号**：`/codex:review` → `/codex-review`（DSH 命令名不允许 `:`）。
- **rescue 变成工具**：Claude 的 `codex:codex-rescue` 子代理改为 `codex_task` 工具 + `/codex-rescue` 命令。
- **不做 `/codex:transfer`**：它读取 `~/.claude/projects`，DSH 没有对应概念。
- **不做 Stop 审查闸门**：DSH 没有 shell hooks，`setup` 里的闸门开关不再生效。
- **引擎零改动**：`vendor/codex/` 是上游 `plugins/codex/` 原样拷贝，只通过 `CLAUDE_PLUGIN_DATA`、`CODEX_COMPANION_SESSION_ID` 和 PATH 注入适配。

## 开发

```bash
node --test        # 全部单测
```

单个命令文件职责：`lib/args.js` 解析参数、`lib/companion.js` 起子进程、`lib/commands.js` 组装命令、`lib/tool.js` 定义工具、`lib/index.js` 接线。

## 许可

Apache-2.0。`vendor/codex/` 派生自 OpenAI 的 codex-plugin-cc，版权归 OpenAI，保留原 `LICENSE` 与 `NOTICE`。

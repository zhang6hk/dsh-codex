# dsh-codex

Bring [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc) into [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): let your local Codex CLI review your changes, or hand investigation and fix tasks to it.

## Install

```bash
# straight from GitHub
dsh plugin add github:zhang6hk/dsh-codex

# or from npm
dsh plugin add @zhang6hk/dsh-codex
```

Desktop: Plugins → Add plugin, then paste either spec. Restart the session and run `/codex-setup` to confirm Codex is ready.

## Requirements

- [Codex CLI](https://github.com/openai/codex): `npm install -g @openai/codex`
- Logged in: `codex login` (ChatGPT account or API key)
- Node.js ≥ 22 (DSH's bundled runtime is enough)

## Commands

| Command | What it does |
|---|---|
| `/codex-review` | Review the current git diff (native review, never edits code) |
| `/codex-adversarial-review <focus>` | Adversarial review: challenge the approach, tradeoffs, assumptions |
| `/codex-rescue <task>` | Hand investigation or fixes to Codex, staying in one thread |
| `/codex-status [job-id]` | Check progress |
| `/codex-result <job-id>` | Read the full result |
| `/codex-cancel <job-id>` | Cancel a task |
| `/codex-setup` | Check CLI, login, and runtime |

Reviews run in the foreground and print Codex's report directly (the upstream engine has no review background mode). `/codex-rescue` runs in the background by default and returns a job id. Flags: `--base <ref>`, `--scope auto|working-tree|branch`, `--model`, `--effort`.

There is also a `codex_task` tool, so the model can delegate a task to Codex inside a conversation.

## Configuration

Edit `config` in `cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-codex
      name: '@zhang6hk/dsh-codex'
      config:
        codexPath: codex       # Codex binary; use an absolute path if it is not on PATH
        model: ''              # default model, forwarded as --model
        effort: ''             # default reasoning effort, forwarded as --effort
        defaultBase: ''        # default review base, e.g. origin/main
        maxConcurrent: 2       # concurrent Codex tasks
        timeoutMs: 1800000     # per-run timeout (30 minutes)
```

## Differences from upstream

Upstream is a Claude Code plugin; DSH has no slash-command files, shell hooks, or markdown subagents, so the port differs in a few places:

- **Command names drop the colon**: `/codex:review` → `/codex-review` (DSH command names cannot contain `:`).
- **rescue becomes a tool**: the `codex:codex-rescue` subagent maps to the `codex_task` tool plus `/codex-rescue`.
- **No `/codex:transfer`**: it reads `~/.claude/projects`, which has no DSH equivalent.
- **No Stop review gate**: DSH has no shell hooks, so the gate toggle in `setup` is inert.
- **Engine untouched**: `vendor/codex/` is a verbatim copy of upstream `plugins/codex/`, adapted only through `CLAUDE_PLUGIN_DATA`, `CODEX_COMPANION_SESSION_ID`, and PATH injection.

## Development

```bash
node --test        # unit tests
```

`lib/args.js` parses flags, `lib/companion.js` runs the child process, `lib/commands.js` assembles commands, `lib/tool.js` defines the tool, `lib/index.js` wires everything.

## License

Apache-2.0. `vendor/codex/` is derived from OpenAI's codex-plugin-cc; copyright OpenAI, with the original `LICENSE` and `NOTICE` preserved.

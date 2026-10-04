# Context Watch for Claude Code

**See how full the context window of every Claude Code session on your machine is, and how much quota
they burn together, in one sidebar panel.**

> Unofficial community extension. Not affiliated with or endorsed by Anthropic.

## Why

`/context` answers for the window you are typing in, and only when you stop and ask. Every other
session stays silent until one of them auto-compacts in the middle of a task you cared about. And
Claude Code never adds spend up *across* sessions: a subagent fan-out in a window you are not watching
can drain a 5-hour quota while you are away, and afterwards nothing tells you which window did it.

Context Watch shows both, refreshed every 5 seconds:

- **A Context Watch panel** with its own icon on the Activity Bar. One card per session: the name the
  Claude Code tab shows, tokens in context, % of the model's window, and whether the session is
  `busy`, `live` or `closed`. Drag the panel to the secondary sidebar to keep it beside your editor.
- **A status bar item** with the % context of the live session in the current workspace. It turns
  yellow at 75% and red at 90%. Click it to open the panel.
- **A burn line**: quota used on this machine in the last 5 hours and 10 minutes, across all sessions
  and their subagents, deduplicated per API request.

## Privacy

Context Watch **reads local files only and sends nothing over the network.** It has no telemetry
and no network code. It reads, without modifying:

- `~/.claude/projects/**/*.jsonl` (session transcripts: token usage and tab titles only)
- `~/.claude/sessions/*.json` (which sessions are running)

It works in Claude Code from the VS Code extension, the CLI, and the desktop app, since they all
write these files. In a Remote (SSH / WSL / container) window it reads the remote machine's files,
which is where Claude Code runs.

## Settings

| Setting | Default | |
|---|---|---|
| `ctxWatch.refreshSeconds` | `5` | How often to re-read session files. |
| `ctxWatch.recentMinutes` | `30` | How long closed sessions stay listed. Live sessions are always shown. |
| `ctxWatch.contextWindows` | `{}` | Window size per model, prefix match, e.g. `{ "claude-sonnet-5": 1000000 }`. |
| `ctxWatch.showBurn` | `true` | Show the burn line. |
| `ctxWatch.statusBar` | `true` | Show the status bar item. |
| `ctxWatch.claudeDir` | `""` | Data directory. Empty = `$CLAUDE_CONFIG_DIR`, else `~/.claude`. |

### Context window sizes

Built in: `claude-opus-5*` = 1M, `claude-haiku-4-5*` = 200k. Any other model shows `window ?`
instead of a guessed percentage; add it to `ctxWatch.contextWindows` to get a bar.

### How burn is counted

Tokens are weighted as input-equivalents: input ×1, cache write ×2, cache read ×0.1, output ×5. The
line turns yellow above 1M in 10 minutes and red above 3M.

## Limits

Context Watch reads Claude Code's internal file formats, which are undocumented and can change in any
Claude Code release. If the panel goes empty after an update, please
[open an issue](https://github.com/anhtaicn/claude-ctx-watch/issues). Errors are logged to the
**Context Watch** output channel.

## License

MIT

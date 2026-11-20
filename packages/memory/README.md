# icex-dsh-memory

Cross-session memory for DeepSeek Harness, in one host plugin.

- **Injected once per session** — a budgeted digest of durable facts enters the context as an inbox message (`agent.inject`), so the system-prompt prefix stays stable and the model can see exactly which memories it received in the session log.
- **One tool, five actions** — `memory` with `add`, `replace`, `forget`, `search`, `list`.
- **Plain Markdown store** you can read, edit and version: `~/.dsh/memory/MEMORY.md` (global) and `<cwd>/.dsh/memory/MEMORY.md` (per working directory).
- **Provenance** — every entry carries `src=<session>@<seq>` and a date; memory is an index into the session log, never a replacement for it.
- **No dependencies** — the tool API is loaded from the running app; when it cannot be found the plugin still injects memory and the policy falls back to editing the file with the built-in filesystem tools.

See [docs/DETAIL.md](docs/DETAIL.md) for the store format, budgets, and known limits.

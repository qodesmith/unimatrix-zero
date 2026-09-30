# The app keeps its own copy of Provider session data

After each Reply the app saves the Provider's raw session data into its own SQLite database as opaque blobs, so any Provider session can be restored exactly, however old the Tree. Providers delete their copies (Claude after `cleanupPeriodDays`, which has no "never" and is enforced by the user's own `claude` sharing `~/.claude`), and the alternative, rebuilding by text replay, re-sends the whole Thread and loses reasoning and tool state. For Claude the Agent SDK's `sessionStore` (alpha, SDK version pinned) writes transcript entries to our store and resumes from a temporary folder, and the app also copies `tool-results/` and `subagents/`; if the store API breaks, writing the transcript file back is the verified fallback. For Codex the app keeps each `rollout-*.jsonl` (possibly `.zst`) and every ancestor a fork points into, and writes it back under its original name before `thread/resume`. Both formats are internal to the Providers, so they are never parsed or edited. Findings: [provider-session-backup research](https://github.com/qodesmith/unimatrix-zero/blob/research/provider-session-backup/docs/research/provider-session-backup.md).

## Consequences

- Resume order: exact restore (silent), then Codex `thread/inject_items` from saved items, then text replay. Only the last two are shown to the user.
- Deleting stored session data is the app's job: a session goes when no Reply references it and, for Codex, no descendant fork still points into it.
- Roughly 10 KB per Turn of extra disk; no cap in v1.
- Signing in as a different account keeps Trees working; Claude may re-think instead of reusing earlier thinking.

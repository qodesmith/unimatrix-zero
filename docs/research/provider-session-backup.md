# Research: backing up and restoring Provider sessions

Date: 2026-09-30. Versions examined: `@anthropic-ai/claude-agent-sdk` 0.3.286 (bundled Claude Code CLI 2.1.286), `codex-cli` 0.159.0.

**Question.** Can Unimatrix Zero save the full underlying Provider session into its own storage and later restore it so that `resume` works *faithfully* (as if the provider never deleted its files), long after the provider cleaned up?

## Summary

| Provider | Faithful restore after cleanup? | Recommended mechanism |
| --- | --- | --- |
| Claude | **Yes** (verified live, both mechanisms) | Agent SDK `sessionStore` adapter backed by our SQLite; fall back to raw JSONL copy/restore if the alpha API regresses |
| Codex | **Yes** (verified live), provided the ancestor rollouts of forked threads are also kept | Store each `rollout-*.jsonl` (and `.jsonl.zst`) as opaque bytes and copy it back into `CODEX_HOME/sessions/**/` under its original filename, then `thread/resume` by id. No DB backup is needed |

---

## Claude (Agent SDK)

### Verdict: yes

Both approaches below restored a deleted session and the model recalled a secret word from the earlier Turn. The resumed Turn also showed a prompt-cache read of the full prior prefix (`cache_read_input_tokens: 30747`), which means the rebuilt request was byte-identical to the original, including the signed thinking block.

### Mechanism A (recommended): `sessionStore` option

What it is (source: `sdk.d.ts` in 0.3.286, `Options.sessionStore`, `SessionStore`, `SessionStoreEntry`; docs: <https://code.claude.com/docs/en/agent-sdk/session-storage>):

- An adapter object with `append(key, entries)` and `load(key)` (required), plus optional `listSessions`, `listSessionSummaries`, `delete`, `listSubkeys`. `SessionKey = { projectKey, sessionId, subpath? }`.
- **Dual-write:** the CLI subprocess still writes JSONL locally; after each successful local write it emits an internal `transcript_mirror` frame on stdout, and the SDK parent batches those entries to `append()` (~100 ms cadence, or `sessionStoreFlush: 'eager'`). Failed appends retry 3x, then the batch is dropped and a `system/mirror_error` message is emitted.
- **Resume from store:** with `resume` + `sessionStore`, the SDK calls `load()` *before spawning*, writes the entries to a temporary config dir (`$TMPDIR/claude-resume-<rand>/projects/<projectKey>/<sessionId>.jsonl`), copies credentials (on macOS, pulls the Keychain entry when `CLAUDE_CONFIG_DIR` is unset), `.claude.json` and user `settings.json` into it, runs the CLI with `CLAUDE_CONFIG_DIR` pointed there, and deletes the temp dir at run end. Subagent transcripts are restored only if `listSubkeys` is implemented (`subpath: "subagents/agent-<id>"`). (Source: `N2`/`dBe` functions in `sdk.mjs`; docs "Resume from the store".)
- Entries are opaque JSON; `load` must return entries deep-equal (not byte-equal) to what was appended, in order. Dedupe on `entry.uuid`.
- If the store has nothing for the session, `resume` falls through to the normal local file.
- **Stability:** every related symbol is tagged `@alpha` in the typings. It is, however, documented on the official docs site with reference adapters (S3/Redis/Postgres) and a conformance suite, and the SDK throws clear errors for unsupported combos.

What it does **not** cover:

- `enableFileCheckpointing` + `sessionStore` throws at startup: file-history backups are not mirrored, so `rewindFiles()` wouldn't work after a store resume.
- `projects/<slug>/<session>/tool-results/` (large tool outputs spilled to files, MCP image copies) is not mirrored; only JSONL files are. The transcript itself still carries the preview that was sent to the model, so context is faithful, but a later `Read` of the spilled path would fail.
- `persistSession: false` is incompatible (the mirror is built on the local write).

Retention interaction: once a session has been resumed from the store, the run leaves **no** local transcript, so the CLI's `cleanupPeriodDays` sweep never sees it. The store is the only copy, and its retention is ours.

Gotcha seen live: the final `append` (cost-state entry) arrives *after* the `result` message. Keep draining the iterator until it ends before treating the store as complete.

### Mechanism B (fallback): copy the JSONL file, write it back

Verified live: copied `<sid>.jsonl`, deleted it, `resume` failed with `No conversation found with session ID: <sid>`, copied the file back, `resume` worked and recalled the secret word. `forkSession: true` on the restored file also worked (new session ID, same memory). Resuming from a *different* `cwd` also found the file: the CLI searches all `projects/*` dirs, so the cwd slug is not critical, but restoring to the original slug is still the safe choice.

What to store per session, besides the main JSONL: `projects/<slug>/<sid>/subagents/*.jsonl` (+ `.meta.json`), `projects/<slug>/<sid>/tool-results/*`, and `file-history/<sid>/` if checkpointing is used. No session index was needed. Nothing in `~/.claude.json` or elsewhere had to be restored.

Restore with a **fresh mtime** (plain copy, not `cp -p`): the sweep deletes files "older than `cleanupPeriodDays`" (docs, "Cleaned up automatically"). The CLI's sweep helpers compare against filesystem `mtime`, so an old restored file could be removed on the next CLI launch. This is inferred from the minified source (`f_()` cutoff, `De()` mtime check) and was not tested live.

### Things that could break faithfulness

- **Org-locked thinking.** Each transcript records a `credential_org` attachment (`organizationUuid`). If the session is resumed signed in to a *different* org, the CLI warns "Claude can't use thinking from another organization… it has to reread this session and generate new thinking" (CLI string `ju`, `org_locked_thinking`). Same-account restore is fine; account switches degrade thinking.
- **Thinking text isn't in the file.** With the SDK defaults, thinking blocks were saved with an empty `thinking` string and a non-empty `signature` (~600–1000 chars). The API reconstructs from the signature, so this doesn't break anything, but we can't render past thinking from the transcript. Capture it from the stream (or set `thinking.display: 'summarized'`) if the UI needs it.
- **Undocumented format / version drift.** The entry union is explicitly "CLI-internal and not part of the SDK API surface". New entry types appear often (`prompt_snapshot`, `atis-latch`, `cost-state`, …). Store entries as opaque blobs and don't transform them. A much newer CLI resuming an old transcript is the same risk the provider itself carries, so it isn't specific to backups.

### Controlling retention instead

- `cleanupPeriodDays` (default 30, min 1, no "never" value; use a large number like 3650) is a user/project/`--settings` setting (`Settings.cleanupPeriodDays`). `managedSettings` via the SDK silently drops it (`sdk.d.ts` note on `managedSettings`).
- The sweep runs on CLI startup against its **whole config dir**. The user's own interactive `claude` shares `~/.claude` and applies *the user's* setting to our files. Our own SDK runs with `settingSources: []` skip the sweep entirely ("Skipping retention cleanup: userSettings source is disabled…"), but that doesn't protect us from the user's CLI. `--bare` also skips it.
- The only real isolation is a dedicated `CLAUDE_CONFIG_DIR` for the app. Then auth must be provided there: copied `.credentials.json`, or the macOS Keychain entry, which is keyed per config dir. Adding a store makes this unnecessary.

### Size

A one-line Turn produced a **~148 KB** JSONL. About 133 KB of that is a single `prompt_snapshot` attachment (full tool schemas, including the user's claude.ai MCP connectors), written once per process start. Each further small Turn added about 6–12 KB. Large tool outputs scale this directly.

### Prompt cache

A restored session keeps cache benefits only within the cache TTL (5 min/1 h). Live, a resume ~1 min later read 30,747 tokens from cache. After a long gap the first resumed request re-writes the whole prefix. The CLI even exposes `prompt_cache_likely_expired` / `estimated_cache_write_usd` on the SessionStart hook. This is still far better than text replay, which also has to re-send everything *and* loses thinking/tool structure.

---

## Codex (app-server)

Source: `openai/codex` at tag `rust-v0.159.0` (paths are relative to `codex-rs/`). Live tests used a temporary `CODEX_HOME` holding a copy of `auth.json`, with `OPENAI_API_KEY` stripped. The user's `~/.codex` was not touched.

### Verdict: yes

A deleted rollout that is restored to `CODEX_HOME/sessions/` resumes with the same thread id and the full turn history, and the model recalled the secret word. This holds even when both SQLite DBs are also deleted, because the DBs are rebuilt from the file.

### Storage layout (live)

- Rollout: `sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`, with `history_mode:"paginated"` in `session_meta`.
- `state_5.sqlite`: has a `threads` table with `rollout_path`.
- `thread_history_1.sqlite`: a projection of the file (turns, items and a byte-offset checkpoint). Names are defined at `state/src/sqlite.rs:33-34`.
- There is no `session_index.jsonl`.

### Restore tests (live)

| Scenario | Result |
|---|---|
| Delete the rollout, then `thread/resume` by id | `-32600 no rollout found for thread id …` |
| Delete the rollout and both DBs | same error |
| Restore the file to the same path, without DBs | **Works.** The DBs are rebuilt, all turns come back, and the model recalls the secret word |
| Restore the file to a different date folder under the original filename | **Works** |
| Restore the file under a different filename | `no rollout found` |
| Pass a `path` param pointing outside `sessions/` | `no rollout found` |

Why (source): lookup falls back to scanning filenames under `sessions/` or `archived_sessions/` for the thread UUID (`rollout/src/list.rs:1659-1685`).

The `path` param on `thread/resume` has these limits (`app-server/src/request_processors/thread_processor.rs:4611-4665`):
- It is experimental and needs `capabilities.experimentalApi: true`.
- Paginated threads are re-read by id, and a mismatching path is rejected ("cannot resume paginated thread … with stale path").

The practical rule is: **keep the original filename**. Archived threads return an error telling you to unarchive them.

### Forks need their ancestors (live)

`thread/fork { threadId, lastTurnId }` on a restored thread worked and cut the history at the given turn. A forked rollout does **not** copy the parent's history. Its `session_meta.history_base = { thread_id: <parent>, end_ordinal_exclusive, end_byte_offset }` points into the parent file by byte offset. The parent must therefore be restored byte-for-byte:

- With the parent file missing, resuming the fork failed with `invalid paginated history lineage … missing source rollout` (`thread-store/src/local/rollout_lineage.rs:77,87`).
- With the parent restored, the fork resumed normally.

### Retention (source)

No age-based deletion of rollouts was found. Rollout files are removed only by an explicit `thread/delete` (`thread-store/src/local/delete_thread.rs`). Only logs (`LOG_RETENTION_DAYS=10`, `state/src/runtime/logs.rs:3`) and memories are pruned.

There is one caveat. A background job can compress rollouts older than 7 days to `.jsonl.zst` (`rollout/src/compression.rs:26,336`). It sits behind the `local_thread_store_compression` feature, which is under development and off by default (`features/src/lib.rs:1168-1170`). Readers accept both forms, so backup code should expect `.zst` too.

Because Codex doesn't auto-delete today, the backup guards against user deletion, `thread/delete`, a machine move, or a future retention policy. It isn't fixing a current sweep.

### `thread/inject_items` and `thread/resume { history }`: context-faithful, not thread-faithful (live)

- `thread/inject_items { threadId, items: ResponseItem[] }` appends raw Responses API items to the model-visible history (`app-server/src/request_processors/turn_processor.rs:974-1001`). Injecting the saved user, assistant and reasoning items (the reasoning item carried `encrypted_content`) into a fresh thread worked: the model recalled the secret word. The items land in the new rollout as response items with no turn events, so the turn list doesn't show them.
- `thread/resume { threadId, history: [...] }` (experimental) also worked. It creates a **new** thread id, because internally it is treated as a fork (`thread_processor.rs:4559-4572`).
- Neither is fully faithful. You get a new id, fresh developer/system messages, and no turn history.
- Tampered `encrypted_content` gave HTTP 400 `invalid_encrypted_content` ("could not be verified"). The item stays in history, so later turns probably fail too (not tested).
- Untampered reasoning items from one model replayed fine into a thread on a different model. `session_meta` records `creator_account_id`/`creator_user_id`, so reasoning may be tied to the account. This couldn't be tested with one account.

Use this path only as a second-tier fallback, above lossy text replay, when the rollout bytes are gone.

### Size (live)

- Turn 1: about 46 KB. Of that, about 22 KB is `session_meta` with the base instructions and about 13 KB is developer messages.
- Each later short Turn: about 7–9 KB. A reasoning item is about 1.6 KB.

### Fragility

The rollout format, the paginated `history_base` lineage and the SQLite projections are all internal. The file format has already changed (the paginated mode is recent). Store the files as opaque bytes and restore them unchanged. Don't try to synthesize or edit rollouts.

---

## What was verified live vs. read from source

**Verified live** (Claude Max and ChatGPT Plus on this machine, tiny prompts, temp cwds, only self-created session files touched and cleaned up):

- Claude:
  - Delete the JSONL, and `resume` fails with "No conversation found".
  - Restore the JSONL, and resume recalls the secret; the prompt cache is hit.
  - `forkSession` on a restored file works.
  - Resuming from a different cwd finds the file.
  - A `sessionStore` backed by a JSON file works: after the local JSONL is deleted, resume recalls the secret and no local file is left behind.
  - Thinking blocks are persisted with a signature but empty text.
- Codex: every result in the Codex tables above.

**Read from source or docs only:**

- Claude:
  - The mtime basis of the `cleanupPeriodDays` sweep, and the sweep being skipped under `settingSources: []` or `--bare`.
  - `tool-results/` and `file-history/` not being mirrored by `sessionStore`.
  - The org-locked thinking warning.
  - The `CLAUDE_CONFIG_DIR` Keychain behaviour.
- Codex:
  - No age-based retention, and the `.zst` compression flag.
  - The account binding of `encrypted_content`.
  - Later-turn behaviour after an `invalid_encrypted_content` error.

## Recommendation for Unimatrix Zero

1. **Claude:** implement a SQLite-backed `SessionStore` (with `append` deduped on `uuid`, plus `load`, `listSubkeys`, `delete`), and always pass it. Keep a thin fallback that can write the stored entries back as JSONL under `CLAUDE_CONFIG_DIR/projects/<slug>/` in case the alpha API changes. Don't combine it with `enableFileCheckpointing`.
2. **Codex:** after each Turn completes, snapshot the thread's rollout file and every `history_base` ancestor into SQLite as opaque blobs. Before `thread/resume`, if `thread/read` fails with "no rollout found", write the files back under their original names and resume by id. Keep `inject_items` as a lower tier before text replay.
3. Both providers: Provider sessions are bound to the signed-in account/org. A restore under a different account degrades thinking/reasoning (Claude) or may be rejected (Codex).

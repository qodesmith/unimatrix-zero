# How T3 Code stores conversation state, and why

Research for [#3](https://github.com/qodesmith/unimatrix-zero/issues/3), part of the [v1 spec map](https://github.com/qodesmith/unimatrix-zero/issues/1).

**Sources.** T3 Code `main` at `de251fc2` (2026-09-27), and the unmerged V2 orchestrator branch `t3code/codex-turn-mapping` at `0dcb029d` ([PR #2829](https://github.com/pingdotgg/t3code/pull/2829)). Paths below are relative to the T3 Code repo root. The Claude Agent SDK type definitions come from `@anthropic-ai/claude-agent-sdk@0.3.283`, `sdk.d.ts`; T3 pins `0.3.276`. The rest are the [Agent SDK sessions docs](https://code.claude.com/docs/en/agent-sdk/sessions), and the Codex app-server protocol schema that T3 generates in `packages/effect-codex-app-server/src/_generated/schema.gen.ts`.

T3 Code's word "thread" means a whole conversation. That is closer to our **Tree** (without Forks) than to our **Thread**. This document says "T3 thread" for T3's meaning.

## Answer in brief

- **T3's own SQLite database is the source of truth.** It never treats Claude's or Codex's session files as the record. It stores an event log plus projections of every message, turn, activity and checkpoint. For each T3 thread it also stores a small **resume cursor**: a pointer into the provider's session.
- **Provider sessions are treated as disposable and resumable, but on `main` they are not rebuildable.** On `main`, a missing Codex rollout silently becomes a fresh, empty Codex thread. A missing Claude transcript bricks the T3 thread ([#2336](https://github.com/pingdotgg/t3code/issues/2336); fix in open [PR #13545](https://github.com/pingdotgg/t3code/pull/13545)).
- **The V2 rewrite makes "app owns history, provider threads are backing handles" an explicit design rule.** It rebuilds a lost provider session from the app's own transcript with a token-budgeted **portable handoff**. That rebuild is lossy.
- **Verdict for Unimatrix Zero: the plan is right**, with changes:
  - Use native provider branching as the fast path.
  - Store enough provider identifiers per Reply to resume and fork at any Reply.
  - Don't count on `~/.claude` surviving, because Claude sweeps transcripts after 30 days by default.
  - Accept that a rebuild is a degraded fallback, not a faithful copy, unless we also mirror the raw provider transcript.

## 1. What T3 persists, and where

### The database

- One SQLite file at `<T3 home>/userdata/state.sqlite` (`apps/server/src/config.ts:136-140`; the home defaults to `~/.t3`, per `AGENTS.md`). Attachments go in `userdata/attachments` (`config.ts:141`), not in the provider's directories.
- **Event log.** Table `orchestration_events` (`apps/server/src/persistence/Migrations/001_OrchestrationEvents.ts:7-23`). The architecture doc says: *"The event log is the source of truth for orchestration state… Events, persisted projections, and the accepted command receipt commit in one database transaction."* (`docs/internals/overview.md:55-62`).
- **Projections (read models).** Tables `projection_threads`, `projection_thread_messages` (full message text), `projection_turns`, `projection_thread_activities`, `projection_thread_sessions` and others (`Migrations/005_Projections.ts:20-112`). The UI renders history from these tables, never from provider files.
- **Provider pointer.** Table `provider_session_runtime(thread_id, provider_name, adapter_key, runtime_mode, status, last_seen_at, resume_cursor_json, runtime_payload_json)` (`Migrations/004_ProviderSessionRuntime.ts:7-18`). This is the only link to the provider's own storage.
- **Workspace checkpoints.** Stored as hidden Git refs, not in SQLite (`docs/internals/overview.md:79-82`). Not relevant to us.

### What the resume cursor holds

- **Claude:** `{ threadId, resume: <Claude session UUID>, resumeSessionAt: <last assistant message uuid>, turnCount, turnStartMessageIds[] }`. It is built in `apps/server/src/provider/Layers/ClaudeAdapter.ts:2183-2201` and parsed in `ClaudeAdapter.ts:969-1008`. T3 generates the Claude session UUID itself on the first start (`ClaudeAdapter.ts:4406-4410`) and passes `resume` or `sessionId` to the SDK (`ClaudeAdapter.ts:4932-4933`).
- **Codex:** only `{ threadId: <Codex thread id> }` (`apps/server/src/provider/Layers/CodexSessionRuntime.ts:84-86`).
- **Glossary:** a Session is *"The provider runtime attached to a thread. A session can be stopped and resumed without deleting the thread."* (`docs/internals/glossary.md:42`).

### What stays in provider storage

- **Claude.** Claude Code writes the real transcript, including tool calls, thinking and compaction boundaries, to `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` ([sessions docs](https://code.claude.com/docs/en/agent-sdk/sessions)). T3 reads it back only for rollback, through the SDK's `getSessionMessages()` (`ClaudeAdapter.ts:5363-5378`). A comment says so directly: *"SDK messages are not kept: rollback reads Claude's own history through turnStartMessageIds"* (`ClaudeAdapter.ts:424-427`).
- **Codex.** The app-server keeps its threads under `CODEX_HOME` (`sessions`, `archived_sessions` and `sqlite`, per `apps/server/src/provider/Drivers/CodexHomeLayout.ts:19-30`).

So the text is duplicated. T3 holds the user-visible transcript. The provider holds the model-visible transcript, which has more in it.

## 2. How T3 resumes

### After an app restart

- `ProviderService.recoverSessionForThread` (`apps/server/src/provider/Layers/ProviderService.ts:1235-1310`) reads the persisted binding. If no live session exists, it calls `adapter.startSession({ resumeCursor, cwd, modelSelection })`. With no cursor it refuses to recover: *"Cannot recover thread … because no provider resume state is persisted."* (`ProviderService.ts:1270-1275`).
- **Claude** resumes with `query({ resume: sessionId })`. **Codex** resumes with the app-server `thread/resume` and `excludeTurns: true` (`CodexSessionRuntime.ts:757-765`). History is never re-sent; the provider already has it.
- Stopped rows are kept for their cursors, so a long-lived install holds thousands of them (`ProviderService.ts:2374-2375`).
- If a turn was running when the server died, it is marked with *"Provider session did not survive a server restart. Send a new message to continue."* (`apps/server/src/serverRuntimeStartup.ts:344-345`).

### After deleted or missing provider session files (on `main`)

- **Codex: silent context loss.** If `thread/resume` fails with an error containing `not found`, `no rollout found` and similar strings, T3 logs a warning and calls `thread/start`. The result is a brand-new Codex thread with no history (`CodexSessionRuntime.ts:61-68`, `:702-708` and `:777-785`). The T3 transcript still shows everything, but the model sees none of it. Nothing is replayed.
- **Claude: the thread gets bricked.** Issue [#2336](https://github.com/pingdotgg/t3code/issues/2336) (open) describes it. T3 saves the cursor before the CLI has flushed anything. If the CLI dies first, every later turn fails with `No conversation found with session ID`, forever. Nothing ever clears the cursor. The reporter points out that *"T3 already has all the conversation text in `projection_thread_messages`, so no user-visible history is lost."* [PR #13545](https://github.com/pingdotgg/t3code/pull/13545) (open) copies the Codex behaviour. It starts a fresh session and warns *"Claude's previous session no longer exists, so a new one was started without its earlier context."* It still does not replay T3's own transcript.

### After a CLI upgrade

- There is no special handling. Resume depends on the new CLI still reading the old session format.
- **Codex already broke once.** Codex removed `thread/rollback` for its newer "paginated" threads. T3 notes: *"It rejects threads that still use legacy history, which have no rollback API since Codex 0.156"* (`CodexSessionRuntime.ts:1288-1296`). The V2 docs spell out the paginated vs legacy split (`docs/orchestration-v2/thread-lineage-and-context-transfer.md:221-223`).
- A Codex resume can also fail because of content inside the provider's own history: [#10362](https://github.com/pingdotgg/t3code/issues/10362), *"Codex misalignmentPolicyViolation in thread history prevents resuming conversations."*
- **Not verified:** whether any Claude CLI upgrade has broken `--resume` of older transcripts.

### Rollback, the closest thing T3 has to our Branch

Rollback means dropping the last N turns.

- **Claude.** T3 reads Claude's transcript and finds the turn boundary. It then calls the SDK's `forkSession(sessionId, { upToMessageId })` to make a new session truncated at that point, and resumes the fork (`ClaudeAdapter.ts:5293-5470`, fork at `:5424-5438`). It fails with *"The exact Claude turn boundary is unavailable, possibly after compaction or recovery of older history. Start a new thread instead."* (`ClaudeAdapter.ts:5411-5420`).
- **Codex.** T3 calls `thread/revert { beforeTurnId }` (`CodexSessionRuntime.ts:1283-1297`).
- **Providers that can't roll back.** Revert must be refused before any files are touched (`docs/internals/overview.md:80-82`; `docs/internals/providers.md:93-96`).

## 3. Why: documented reasons

- **App identity must not depend on provider identity.** V2 invariant #1 is *"App ids are primary. Provider ids are refs."* (`docs/orchestration-v2/README.md:33`, V2 branch). Another rule: *"Provider-specific behavior belongs behind an adapter. Orchestration works with normalized commands and events"* (`docs/internals/overview.md` on `main`, "Ownership boundaries").
- **Several providers in one conversation.** V2 says *"The app thread remains the source of truth for full history"* (`docs/orchestration-v2/provider-switching-and-context.md:77`) and *"Provider-native threads are backing handles with explicit coverage"* (`thread-lineage-and-context-transfer.md:40`).
- **Raw provider data is evidence, not state.** *"Raw provider frames are evidence and replay input, not the source of truth for normal app state."* (`docs/orchestration-v2/core-graph-and-data-model.md:570`; also `:29` and `:553`).
- **Performance and remote clients.** Clients subscribe to projections over websockets, and per-thread subscriptions keep payloads small (`docs/internals/overview.md` "Ownership boundaries"; `AGENTS.md` "Performance without compromise"). Provider JSONL files are neither indexed nor streamable to remote clients.
- **Why they still resume native sessions instead of always rebuilding.** V2 gives the reason: *"Always creating a fresh provider thread … loses useful provider-native continuity: prior hidden reasoning/context that is only available in the provider thread, provider-side thread metadata, native tool state…"* It also *"forces every switch to depend on full summarization quality."* (`provider-switching-and-context.md:38-47`).
- **Not found:** an ADR or maintainer comment explaining why V1 chose SQLite over provider files. The reasoning above comes from the V2 design docs and the architecture doc.

## 4. What V2 does (unmerged, but it is where T3 is heading)

- **Forks are lazy lineage records.** `thread.fork` creates a new app thread plus a pending `ContextTransfer`. The first run then resolves it:
  1. **Native fork** when the provider is the same and supports it: Claude `forkSession`, or Codex `thread/fork { lastTurnId }`.
  2. **Portable handoff** otherwise.

  Source: `docs/orchestration-v2/thread-lineage-and-context-transfer.md:171-197` and `:221`. Issue [#1404](https://github.com/pingdotgg/t3code/issues/1404) ("conversation branching") is marked as closed by #2829.
- **Resume failure falls back to a rebuild.** `ProviderTurnStartService.ts:644-690` (in `apps/server/src/orchestration-v2/`) logs *"Provider resume failed; attempting a fresh native session"*. It then binds a fresh native session and prepends a `full_thread_summary` handoff built from the app's own transcript (`projectionStore.getTurnStartHistory`).
- **Claude always resumes pinned to the known head.** It passes `resumeSessionAt` = the last native message id T3 recorded (`orchestration-v2/Adapters/ClaudeAdapterV2.ts:6242` and `:6276-6286`). This guards against drift from anything appended outside T3.
- **How the rebuild works, and why it is lossy:**
  - Codex gets real history items through `thread/inject_items`, described as *"Raw Responses API items to append to the thread's model-visible history."* (`orchestration-v2/Adapters/CodexAdapterV2.ts:5467-5475`; schema at `schema.gen.ts:54680-54689`).
  - Other providers, Claude included, get the selected history as text prepended to the user message (`ProviderTurnStartService.ts:1087-1096`).
  - The selection is capped at 16,000 tokens by default (`orchestration-v2/ContextHandoffBudget.ts:14-19`; env var `T3CODE_CONTEXT_HANDOFF_TOKEN_CAP`, 1,024-64,000).
  - The user docs: *"A handoff does not copy the outgoing provider's reasoning, tool-call state, or attachments … A handoff is a budgeted selection, not an agent-written summary."* The agent can pull omitted history back through a T3 MCP "thread-reading tool" (`docs/user/portable-handoffs.md:6-18`).
- **Migrating V1 to V2 also rebuilds.** *"The migration does not recreate the old provider's live session… The first new message starts a fresh provider session."* (`docs/user/thread-migration.md:20-31`).

## 5. What the Claude and Codex SDKs give us

### Claude Agent SDK

All from `sdk.d.ts` 0.3.283 unless noted.

- **Where sessions live.** `~/.claude/projects/<encoded-cwd>/<id>.jsonl`, or under `CLAUDE_CONFIG_DIR`. Resume works *"Same machine only: the session file still needs to exist"* ([sessions docs](https://code.claude.com/docs/en/agent-sdk/sessions)).
- **Resume options.** `resume`, `sessionId` (a caller-chosen UUID), `resumeSessionAt` (*"only resume messages up to and including the message with this UUID"*) and `forkSession: true` (`sdk.d.ts:2081-2098` and `:1702-1706`). The standalone `forkSession(sessionId, { upToMessageId })` *"remap[s] every message UUID and preserv[es] the parentUuid chain… Forked sessions start without undo history"* (`sdk.d.ts:825-858`).
- **Branching at any Reply without replay.** Together these can branch at any Reply: `resume: S, resumeSessionAt: <last uuid of that Reply>, forkSession: true`. The docs confirm fork leaves the original untouched.
- **Transcripts are swept after 30 days.** `cleanupPeriodDays`: *"Number of days to retain chat transcripts before automatic cleanup (default: 30)"* (`sdk.d.ts:6652-6654`). T3 never sets it; a grep of `main` and V2 finds no match. Any Tree left idle for more than 30 days would lose its native Claude session, unless the user changed that setting.
- **`persistSession: false`** keeps a session in memory only; it can't be resumed (`sdk.d.ts:1807-1814`).
- **`sessionStore` (`@alpha`).** It *"Mirror[s] session transcripts to an external store"*. On resume, `load()` *"is materialized to a temporary JSONL file; the subprocess resumes from that file"*. Entries are opaque JSON blobs keyed by `uuid` (`sdk.d.ts:1815-1826` and `:6440-6548`; [session-storage docs](https://code.claude.com/docs/en/agent-sdk/session-storage)). This allows a **faithful** rebuild: keep the raw transcript entries in our SQLite and resume from them even after `~/.claude` has been swept. It still requires local writes (it can't be combined with `persistSession: false`). T3 does not use it.
- **Anthropic's own advice.** Under "Resume across hosts", the docs list *"Don't rely on session resume. Capture the results you need … as application state and pass them into a fresh session's prompt. This is often more robust"* ([sessions docs](https://code.claude.com/docs/en/agent-sdk/sessions)).

### Codex app-server

From T3's generated schema, `packages/effect-codex-app-server/src/_generated/meta.gen.ts:1-40`.

- Available methods: `thread/start` (with `ephemeral`), `thread/resume`, `thread/fork` (with `lastTurnId` and `ephemeral`), `thread/revert`, `thread/inject_items`, `thread/compact/start`, `thread/read`, `thread/turns/list` and `thread/delete`.
- The [app-server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md) confirms that `thread/rollback` was removed in favour of `thread/revert`.
- **Not verified:** Codex's on-disk retention policy for rollouts, and whether `inject_items` accepts assistant-role items as faithful history. T3 sends them that way, but I did not test it.

## 6. Verdict on "the app owns the Tree in local SQLite; provider sessions are disposable copies it can rebuild"

**Keep it.** T3 reached the same place after a year of production bugs. T3's history is the source of truth, and V2 makes provider threads explicit "backing handles". The Tree also *has* to live in our database for other reasons. A provider session is a single linear Thread, while a Tree has Forks. Canvas mode needs indexed, streamable data. And several Threads can stream at once.

Refinements the plan needs:

1. **Rebuild is the fallback, not the path.** Every Branch should use provider-native branching. For Claude: `resume` + `resumeSessionAt` + `forkSession`. For Codex: `thread/fork { lastTurnId }`. That needs no replay, keeps hidden reasoning and tool state, and costs almost nothing.
2. **Store provider coordinates on every Reply, not just per conversation.** For Claude, store `(sessionId, last message uuid)`; for Codex, `(threadId, turnId)`. T3's per-thread cursor is enough for a line but not for a Tree.
3. **Plan for losing `~/.claude`.** The 30-day sweep means an old Tree's native session *will* disappear. To make rebuilds faithful for Claude, consider `sessionStore`: mirror the raw transcript entries into our SQLite. It's `@alpha`, so hide it behind our own seam. Otherwise, accept a lossy rebuild.
4. **Detect a missing session explicitly and never fall back silently.** T3's Codex `thread/start` fallback quietly drops the model's memory while the UI still shows the full history. That is the worst kind of drift. Its Claude path bricked conversations instead (#2336). Save the cursor only after the provider has persisted something.

### Risks and downsides

| Risk | Detail | Mitigation |
| --- | --- | --- |
| Drift between the Tree and the provider session | Compaction rewrites the provider transcript, so turn boundaries stop matching (T3's "boundary unavailable, possibly after compaction", `ClaudeAdapter.ts:5418`). Stale Codex history modes, CLI edits and `/clear` also cause drift. | Pin resumes with `resumeSessionAt`, as V2 does. Key each Reply to provider message ids. Treat a mismatch as "rebuild", not as an error. |
| Rebuild cost and quality | A rebuild re-sends the whole Thread as input tokens, which eats into the $20 plan's 5-hour window. A text preamble loses reasoning, tool state and attachments. T3 caps it at 16k tokens and leans on a retrieval tool. | Prefer native fork. Only rebuild when resume fails. Show the user when a Thread was rebuilt. For Claude, make rebuilds faithful through `sessionStore`. |
| Losing provider-side features | Provider-side compaction summaries, hidden reasoning, and Claude's "resume with a summary?" dialog (`ClaudeAdapter.ts:4581-4620`). Codex drops developer messages when it compacts; T3 re-injects them (`CodexAdapterV2.ts:1565-1580`). | A rebuilt session starts uncompacted, so Context size resets. Our Context size display must come from provider telemetry, not our own sums. |
| Duplicated storage | The user-visible text is stored twice, three times with `sessionStore`. Every Branch forks a full copy of the transcript file (a Claude fork copies the whole history). | The cost is small next to the benefit. Clean up provider sessions when a Branch is deleted: `deleteSession()` for Claude, `thread/delete` for Codex. |
| Orphans and garbage | Deleting a Prompt deletes its Branch in the Tree, but not the provider sessions behind it. T3 keeps thousands of stopped rows. | Garbage-collect provider sessions per Branch when it's deleted. |
| CLI and format upgrades | Resume depends on the CLI still reading old files (Codex 0.156 removed rollback). | The rebuild fallback covers this, which is the main argument *for* the plan. |

**Nothing argues against owning the Tree.** The arguments against are about treating rebuilds as free or faithful, and they are covered above.

## Unverified

- The Claude CLI's backward compatibility with old transcripts across upgrades.
- Codex rollout retention, and whether `thread/inject_items` preserves assistant turns faithfully.
- Whether `sessionStore` (`@alpha`) behaves identically under subscription (OAuth) auth. It is a local mirror hook, so it probably does, but I did not test it.
- An explicit T3 maintainer rationale for the V1 SQLite design (none found).

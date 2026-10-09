# Subagents on both Providers in plain and Workspace Trees

Research for [Subagents on both Providers in plain and Workspace Trees](https://github.com/qodesmith/unimatrix-zero/issues/31), part of the map [#1](https://github.com/qodesmith/unimatrix-zero/issues/1). It unblocks the grilling ticket [Subagents in every Tree](https://github.com/qodesmith/unimatrix-zero/issues/32). Researched 2026-10-09.

**Question:** what do the Claude Agent SDK's subagent tool (`Agent`, formerly `Task`) and Codex's `multi_agent` feature actually do under the sessions we run, in plain Trees (Claude otherwise tool-free; Codex locked down with `environments: []` per [Capability tiers and system prompts](https://github.com/qodesmith/unimatrix-zero/issues/9)) and in Workspace Trees? Covers switching them on, limiting their tools, inheritance, limits, the stream, the Provider session, usage and Stop.

## Sources and method

| Thing | Version |
| --- | --- |
| `@anthropic-ai/claude-agent-sdk` | 0.3.295 (bundles Claude Code 2.1.295) |
| Local `claude` | 2.1.295, claude.ai login (Max), `apiKeySource: "none"` |
| Local `codex` | codex-cli 0.160.1, ChatGPT login (Plus) |
| openai/codex source | tag `rust-v0.160.1` (release tarball); paths relative to `codex-rs/` |
| Codex account | `account/read`: `type: "chatgpt"`, `planType: "plus"` |

- **Claude:** `sdk.d.ts` in the npm package (quoted as **[sdk.d.ts]**); docs fetched as Markdown on 2026-10-09 from `code.claude.com/docs/en/`: [Subagents in the SDK](https://code.claude.com/docs/en/agent-sdk/subagents.md), [Create custom subagents](https://code.claude.com/docs/en/sub-agents.md), [Configure permissions](https://code.claude.com/docs/en/agent-sdk/permissions.md), [Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output.md), [Manage costs](https://code.claude.com/docs/en/costs.md).
- **Codex:** the Rust source at `rust-v0.160.1` (quoted as **(source: path)**), the app-server protocol, and the docs at [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) (redirected from `developers.openai.com/codex/subagents`) and the [Codex pricing FAQ](https://learn.chatgpt.com/codex/pricing), fetched 2026-10-09.

**Live tests.** Claims marked **(verified live)** were run on 2026-10-09 against the real subscription logins with throwaway scripts outside the repo.

- Claude: the SDK with `settingSources: []`, `strictMcpConfig: true`, `mcpServers: {}`, a custom `systemPrompt`, `ANTHROPIC_API_KEY` stripped, `cwd` an empty temp folder, Haiku as the main Model. Credentials come from the macOS Keychain, so no `CLAUDE_CONFIG_DIR` copy was made; `settingSources: []` means no user config was read, and the only thing written under `~/.claude` was the test transcripts (deleted afterwards).
- Codex: `codex app-server` over stdio JSON-RPC with `initialize.capabilities.experimentalApi: true`, a temporary `CODEX_HOME` holding only a copy of `auth.json`, `OPENAI_API_KEY`/`CODEX_API_KEY` stripped, `cwd` an empty temp folder. The plain-Tree lockdown was `environments: [], approvalPolicy: "untrusted", sandbox: "read-only"`. Most tests used `gpt-6-luna` at `effort: "low"`. `~/.codex` was not touched.

---

## TL;DR

| Question | Claude (Agent SDK, `Agent` tool) | Codex (app-server, `multi_agent`) |
| --- | --- | --- |
| On in a plain Tree without shell/files? | **Yes.** `tools: ['Agent', 'WebSearch']`; a subagent can't get tools the main thread lacks (verified live) | **Already on by default**, even with `environments: []`. Children inherit the empty environment (verified live) |
| Off switch | Leave `Agent` out of `tools` | **`agents.enabled = false`**. `features.multi_agent = false` does **not** remove them on current models (verified live), contrary to #9's assumption |
| Limit one subagent's tools (e.g. web search only) | **Yes**, `AgentDefinition.tools: ['WebSearch']` (verified live) | **No.** Children clone the parent's config. Roles can only switch off shell, apps, plugins, memory and permission tools, not web search or single MCP servers (source) |
| System prompt | **Not** inherited: the subagent runs its own `prompt` plus a Claude Code environment block | **Inherited** (`baseInstructions` and `developerInstructions`), plus Codex-added `<multi_agent_role>`/`<multi_agent_mode>` messages |
| Conversation | Not inherited; only the prompt the model writes | V2 default: the whole Thread so far (fork), cold-read |
| Model | Per definition, or per call; default the main Model (verified live) | Inherited; the model may pick another per spawn (verified live) |
| Approvals | `canUseTool` and `PreToolUse` fire, tagged with the subagent's id (verified live) | Child approval requests reach the client with the **child's** `threadId` (verified live) |
| Concurrency / depth | 20 at once, 3 levels deep by default; env vars change both | V2: 3 live children (4 threads incl. root), **no depth limit**; V1: 6 threads, depth 1 |
| Stream | `task_started`/`task_progress`/`task_notification`, subagent messages tagged `parent_tool_use_id` + `agent_id`; no token deltas | Parent gets `subAgentActivity` items; each child streams as its own thread (with deltas). Task text is encrypted in V2 |
| Provider session | Subagent transcript in its own file; fork at a Reply that used one works (verified live) | Each child is its own thread and rollout file; fork/revert/resume of the parent work, forks are not linked to the children (verified live) |
| Usage | Counts against plan usage; reported per subagent | Same account pool; no subagent-specific accounting |
| Stop | Foreground subagents killed with the turn; background ones killed too unless `perTaskStopAffordance` (verified live) | **Children keep running.** Each child turn must be interrupted separately (verified live) |
| Surprise | Background subagents start an **extra turn with no Prompt** when they finish (verified live). `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` prevents it | A child that finishes after Stop emits an item on the parent's already-ended turn |

---

## Claude: the `Agent` tool

### Switching it on in a plain Tree (verified live)

The Agent tool is an ordinary built-in tool: `tools: ['Agent']` turns it on and nothing else. The init message then lists `tools: ["Task"]` (the old name; `tool_use` blocks say `"Agent"`) and **no shell or file tools**. A plain Tree that keeps web search uses `tools: ['Agent', 'WebSearch']`.

**A subagent can only get tools the main thread has.** Its pool is the parent's tools, narrowed; it can't add built-in tools back:

| Setup | Result (verified live) |
| --- | --- |
| Main `tools: ['Agent']`, subagent `tools: ['WebSearch']` | Refused before it starts: `Agent 'web' would be spawned with zero tools — refusing. Its tools list resolved to nothing: unrecognized [WebSearch].` |
| Main `tools: ['Agent']`, subagent `tools: ['Bash']` | Same refusal, `unrecognized [Bash]` |
| Main `tools: ['Agent', 'WebSearch']`, subagent `tools: ['Bash', 'WebSearch']` | Runs with **WebSearch only**; Bash silently dropped |
| Main `tools: ['Agent', 'WebSearch']`, subagent `tools: ['WebSearch']` | Runs with WebSearch only, searches fine |
| Main `tools: ['Agent']`, built-in `general-purpose`, no `tools` | It reported having only `Agent` (self-report) |

So the plain-Tree lock from #9 survives: switching subagents on doesn't give the shell or files back. The docs mention one exception, "On macOS, Linux, and WSL, a subagent can also receive the Glob and Grep tools when the main conversation doesn't have them" ([sub-agents](https://code.claude.com/docs/en/sub-agents.md#available-tools)); it did not happen in these tests (the general-purpose agent reported only `Agent`), but that is a self-report, so treat Glob/Grep as possible.

**Per-subagent tool limits** come from `AgentDefinition.tools` (allowlist) and `disallowedTools` (denylist, accepts `mcp__server`, `mcp__server__*`, `mcp__*`) [sdk.d.ts `AgentDefinition`]. "A tool you leave out isn't in the subagent's session at all" ([SDK subagents](https://code.claude.com/docs/en/agent-sdk/subagents.md#tool-restrictions)). A web-search-only subagent is `tools: ['WebSearch']` (verified live).

**Built-in agent types are on by default.** With only `agents: { web }` passed, init listed `claude, Explore, general-purpose, Plan, statusline-setup, web`. `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1` in `env` leaves only ours (verified live: `agents: ["web"]`). Without it, the model can spawn `general-purpose`, which takes every tool the parent has.

### What a subagent inherits

| Thing | Inherited? | Source |
| --- | --- | --- |
| Tools | Parent's pool, narrowed by `tools`/`disallowedTools`; background runs get a smaller built-in set; `AskUserQuestion`, `EnterPlanMode`, `Workflow`, etc. always removed | docs [Available tools](https://code.claude.com/docs/en/sub-agents.md#available-tools); verified live above |
| Web search | Only if the parent has `WebSearch` | verified live |
| MCP servers | Yes, the parent's servers (an SDK in-process server was inherited and called by the subagent, verified live). `AgentDefinition.mcpServers` can **add** servers the parent lacks, and `strictMcpConfig` does not filter servers passed inline via the SDK `agents` option | docs [Scope MCP servers](https://code.claude.com/docs/en/sub-agents.md#scope-mcp-servers-to-a-subagent) |
| `canUseTool` | Yes. Fires for subagent tool calls with `options.agentID` set to the subagent's id (verified live, `WebSearch`, `mcp__…`, `Write`) | [sdk.d.ts] `agentID?: string` "If running within the context of a sub-agent" |
| `PreToolUse` hooks | Yes, with `agent_id` and `agent_type` in the input (verified live). `SubagentStart` / `SubagentStop` hooks also fire (verified live) | [sdk.d.ts `BaseHookInput`] |
| Permission mode | Inherited. In `acceptEdits`/`bypassPermissions`/`auto` the parent's mode wins over `AgentDefinition.permissionMode`. Verified live in a Workspace-like setup (`acceptEdits`, five file tools): the subagent's write inside `cwd` was auto-approved, its write to a path outside went to `canUseTool` with `agentID` | docs [Permission modes](https://code.claude.com/docs/en/sub-agents.md#permission-modes) |
| System prompt | **No.** The subagent runs `AgentDefinition.prompt` plus an environment block Claude Code appends (working directory, platform, rules such as how to format the final report). The parent's System prompt is not seen: a subagent asked about the parent's secret word did not know it (verified live) | docs [What loads at startup](https://code.claude.com/docs/en/sub-agents.md#what-loads-at-startup) |
| CLAUDE.md | Loaded per `settingSources` (none with `settingSources: []`); `omitClaudeMd: true` skips it | docs |
| Model | `AgentDefinition.model` (alias, full id or `'inherit'`); the model can also pass a per-call `model`; else `CLAUDE_CODE_SUBAGENT_MODEL`; else the main Model. Verified live: main `haiku`, subagent `model: 'sonnet'` ran as `claude-sonnet-5-5`. `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` stops per-call overrides | docs [Choose a model](https://code.claude.com/docs/en/sub-agents.md#choose-a-model) |
| Thinking, effort | Thinking config inherited; `effort` per definition or per call | docs |
| Conversation | No. Only the prompt Claude writes into the Agent call (forks excepted, which the SDK doesn't use unless turned on) | docs |

### Limits

| Limit | Default | Set with | Source |
| --- | --- | --- | --- |
| Nesting depth | 3 layers below the main thread | `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (`1` = no nesting) | docs [Cap subagent depth, concurrency, and spend](https://code.claude.com/docs/en/agent-sdk/subagents.md#cap-subagent-depth-concurrency-and-spend) |
| Running at once | 20 | `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`; at the limit the Agent call returns `Concurrent subagent limit reached` | same |
| Total per session | No limit | | same |
| Spend | None | `maxBudgetUsd` (dollar estimate, not meaningful on a subscription) | same |
| Turns per subagent | None | `AgentDefinition.maxTurns` | [sdk.d.ts] |

Two foreground subagents spawned in one Reply ran concurrently (verified live: their tool calls interleaved).

### What reaches us in the stream (verified live)

For each Agent call:

1. The main thread's `assistant` message with a `tool_use` block named `Agent` (input: `description`, `prompt`, `subagent_type`, `run_in_background`).
2. `system/task_started` with `task_id` (the subagent id), `tool_use_id` (the Agent call), `subagent_type`, `is_backgrounded`, `spawn_depth`, `parent_task_id` (for nested spawns) and `prompt`.
3. The subagent's own `assistant` and `user` messages, each with `parent_tool_use_id` = the Agent call id and `agent_id` = the `task_id`. Its tool calls always come through; its text came through too in these tests even without `forwardSubagentText: true`, though the type docs say text is only guaranteed with it [sdk.d.ts `forwardSubagentText`].
4. `system/task_progress` (tool count, tokens, last tool name; a one-line `summary` with `agentProgressSummaries: true`).
5. `system/task_updated` (`status: completed | failed | killed`) and `system/task_notification` (`status: completed | failed | stopped`, `summary` = final report, `usage`).
6. The main thread's `user` message with the `tool_result` for the Agent call, wrapped in a "[Subagent hand-back]" header.

**No token deltas from subagents:** "Stream events are emitted for the main session only; token-level deltas from subagents aren't forwarded" ([Streaming output](https://code.claude.com/docs/en/agent-sdk/streaming-output.md)). A subagent's text arrives as whole messages.

**Background subagents break "one Prompt, one Reply" (verified live).** With a background subagent the Reply ends (`result: "launched"`) while the subagent keeps working and streaming. When it finishes, the CLI starts **a new turn on its own**: a second `system/init`, a new assistant message and a second `result`, with no Prompt from the user. The `bg` run produced two `result` messages for one Prompt. `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` forces every subagent into the foreground and removes the `run_in_background` parameter from the Agent tool (verified live: the model reported "the Agent tool has no such parameter").

### Provider session: forking, rewinding, replaying (verified live)

- The main transcript (`<session>.jsonl`) holds only the Agent `tool_use` and its `tool_result` (the final report). The subagent's own messages go to `<session>/subagents/agent-<id>.jsonl` plus a `.meta.json` (`agentType`, `toolUseId`, `spawnDepth`, `requestShape`), with `isSidechain: true`.
- **Forking at a Reply that used a subagent works.** Turn 1 had a subagent fetch a secret word; turn 2 set a fruit. `resume` + `resumeSessionAt: <last assistant uuid of turn 1>` + `forkSession: true` produced a new session that knew the word and said UNKNOWN for the fruit. A plain resume of the original knew both.
- The fork **does not copy the `subagents/` folder**. That only matters for resuming a finished subagent (`SendMessage` with its id), which our plain-Tree toolset doesn't include. The parent's knowledge of what the subagent found lives in the main transcript and survives the fork.
- Replaying a Thread as text (moving a Branch to Claude) just carries the Reply text; nothing subagent-specific is needed.
- For the `SessionStore` backup route in the provider-session-backup research, subagent transcripts are restored only if `listSubkeys` is implemented (`subpath: "subagents/agent-<id>"`). Needed only to resume subagents later.

### Usage

- Docs: "every subagent … sends its own requests on top of the main conversation's", and "The subagent's own requests still draw on your usage" ([Manage costs](https://code.claude.com/docs/en/costs.md)). No subscription-specific rule beyond that.
- The `result` message's `modelUsage` includes the subagent's Model (verified live: `claude-haiku-5-5` and `claude-sonnet-5-5` both listed), and `task_notification.usage` gives per-subagent `total_tokens`, `tool_uses`, `duration_ms`.
- Each subagent starts a fresh context, so the first request of each one is a cold read of its own system prompt and tools; a small subagent is cheap (a no-tool `general-purpose` run used about 3.6k tokens).

### Stop

| Case | What `interrupt()` did (verified live) |
| --- | --- |
| Foreground subagent mid-run | Killed at once: `task_updated status: killed`, `task_notification status: stopped`, the Agent call's `tool_result` says the tool use was rejected, and the Reply ends with `result.subtype: error_during_execution`. The next Prompt works normally |
| Background subagent, default options | Interrupt **also kills it**, even though the Reply had already finished. The main model is not told: asked afterwards, it said the agent was "still running" |
| Background subagent, `perTaskStopAffordance: true` | Interrupt **spares** it. It ran to completion about 90 s later and then triggered the unsolicited extra turn described above. Individual tasks are stopped with `query.stopTask(taskId)` |

[sdk.d.ts `perTaskStopAffordance`] confirms both: without it "the interrupt kills background tasks"; with it "Stop only aborts the turn". With all subagents in the foreground, Stop behaves exactly like a normal Stop.

### Workspace Trees

- Subagents inherit the Workspace's tools, `cwd` and permission mode, and their out-of-folder writes reach `canUseTool` tagged with `agentID` (verified live). The app's approval card can name the subagent.
- Several foreground subagents can write to the same working copy at once; nothing serialises them (inferred; Claude Code has no file locking between agents).
- A background subagent could keep writing after the Reply finished, so the Reply's Snapshot would miss its changes. Foreground-only avoids this (inferred from the background behaviour above).

---

## Codex: `multi_agent`

### Two backends, picked by the Model

| | V1 (`multi_agent`) | V2 (`multi_agent_v2`) |
| --- | --- | --- |
| Tool namespace | `multi_agent_v1`: `spawn_agent`, `send_input`, `wait_agent`, `resume_agent`, `close_agent` | `collaboration`: `spawn_agent`, `followup_task`, `send_message`, `wait_agent`, `list_agents`, `interrupt_agent` |
| Models (bundled `models-manager/models.json`) | gpt-5.6-luna | gpt-6-astra, gpt-6.1-sol, gpt-6-sol, gpt-6-luna, gpt-5.6-sol, gpt-5.6-terra |

The Model's catalog entry (`multi_agent_version`) decides; the feature flag is only a fallback for Models that don't say (source: `core/src/config/mod.rs` `multi_agent_version_for_model`, about line 1585-1611). gpt-5.5 has no entry. Everything below is V2 unless marked V1, because V2 is what current Models get.

### Switching it on, or off, in a plain Tree

- **It is already on in a plain Tree.** The collaboration tools are added by `add_collaboration_tools` (source: `core/src/tools/spec_plan.rs:1299`), independent of environments. With `environments: []` the parent listed the six `collaboration.*` tools, and a child it spawned listed the same and nothing else: no shell, no `apply_patch` (verified live).
- **`features.multi_agent = false` does not remove them.** gpt-6-luna and gpt-6.1-sol still had all `collaboration.*` tools, and gpt-5.6-luna still had all `multi_agent_v1__*` tools (verified live). This corrects the plain-Tree lockdown in [Capability tiers and system prompts](https://github.com/qodesmith/unimatrix-zero/issues/9).
- **`agents.enabled = false` removes them** (`config: {"agents.enabled": false}` on `thread/start`), for both backends (verified live; source: `config/mod.rs:1586-1592`; docs: "Set it to false to disable multi-agent tools"). An explicitly enabled `features.multi_agent_v2` overrides it.

### Limiting a subagent's tools

- A child is a **clone of the parent's effective config**: same environments, sandbox and permission profile, approval policy, tool config (source: `core/src/agent/child_config.rs` `build_agent_shared_config`, `apply_spawn_agent_runtime_overrides`; `core/src/agent/control.rs:578` `inherited_environments_for_source`). So a locked-down parent gives locked-down children.
- The only per-child narrowing is an **agent role**: `[agents.<name>] config_file = …`, chosen by the model through `agent_type`. In 0.160.1 a role can set `developer_instructions`, `model`, reasoning effort, verbosity, personality and `service_tier`, and can switch **off** `shell_tool`, `apps`, `plugins`, `memory_tool`, `request_permissions_tool` and skills (source: `core/src/agent/role.rs:37-120`). It **cannot** take away web search or one MCP server.
- **The docs disagree:** they say custom agent files can set `sandbox_mode` and `mcp_servers`; the 0.160.1 source ignores those keys in role files (not tested live).
- In V2 a default spawn is a full-history fork (`fork_turns: "all"`), and roles apply only to non-fork spawns or an explicit `agent_type` (source: `child_config.rs` `prepare_agent_spawn_config`; `multi_agents_v2/spawn.rs:281-292`).
- **So "a web-search-only subagent" is per Tree, not per child** (inferred from source).

### What a child inherits

| Thing | Inherited? | Evidence |
| --- | --- | --- |
| Environments (shell, files) | Yes, the parent's; empty stays empty | child rollout `world_state.environments = {}` (verified live) |
| Sandbox, approval policy, cwd | Yes, re-applied from the live parent turn | child `thread_settings_applied`: `untrusted`, read-only, same cwd (verified live); docs: "Subagents inherit your current sandbox policy" |
| Approval routing | **Yes.** A child's `item/commandExecution/requestApproval` arrives at the client with the **child's** `threadId` and `turnId`. Declining worked, and the child reported the failure to the parent | verified live, in a Workspace-like thread (default environment, `untrusted`, read-only) |
| `baseInstructions` (System prompt) | Yes | child echoed the parent's marker (verified live) |
| `developerInstructions` | Yes, unless `multi_agent_v2.subagent_developer_instructions` or a role overrides them | verified live |
| Codex's own additions | Every thread on a V2 Model, root and child, also gets a `<multi_agent_role>` developer message and a `<multi_agent_mode>` message ("Do not spawn sub-agents unless the user or applicable AGENTS.md/skill instructions explicitly ask…"), **even with a custom `baseInstructions`** | verified live; text from `models.json` `multi_agent.role` |
| Conversation | V2 default: the whole Thread so far (user, developer and final-answer messages; tool calls dropped). The child's first turn is cold: 10,745 input tokens, 0 cached, on a short Thread | source: `core/src/agent/control/spawn.rs:86-128`; child `session_meta.forked_from_id` (verified live) |
| Model, reasoning effort | Inherited by default. The model can pick others per spawn (V1 always; V2 when `expose_spawn_agent_model_overrides`, default true), limited to `model/list`. Order: spawn argument, `agents.default_subagent_model`/`default_subagent_reasoning_effort`, parent | verified live: gpt-5.6-luna spawned a child on gpt-6-luna at `low` |
| MCP servers, connectors | Yes, through the config clone | V1 child listed the same `mcp__codex_apps__*` tools (verified live) |
| Web search mode, hooks | Yes, through the config clone | inferred from source |
| `dynamicTools` from `thread/start` | **No.** The spawn path never passes dynamic tools | inferred from source |

### Limits

- **V2:** `agents.max_concurrent_threads_per_session` (alias `max_threads`), default 4 **including the root**, so 3 live children (source: `config/mod.rs:255, 2760-2771`). Asked for 5 slow children at once, 3 started and 2 failed with `collab spawn failed: agent thread limit reached`; 5 fast ones all succeeded because finished children free their slot (verified live). **No depth limit:** `max_depth` is "Ignored by V2", and root → child → grandchild worked (verified live).
- **V1:** 6 concurrent threads, `agents.max_depth` default 1, so a child has no spawn tool (verified live).
- No overall count limit beyond the live-thread cap (inferred from source).

### What reaches us in the stream (verified live)

- **V2 parent thread:** a `subAgentActivity` item per event: `{kind: "started" | "interacted" | "interrupted" | "completed", id, agentThreadId, agentPath: "/root/<task_name>"}` (`protocol/src/protocol.rs:4396`). `wait_agent` appears as a `collabAgentToolCall {tool: "wait"}` with empty states.
- **The task text isn't readable in the stream on V2:** `spawn_agent.message` is an encrypted field (`multi_agents_spec.rs:630-638`); the child's rollout has it in plain text, but no `userMessage` item streams for the child.
- **A failed spawn produces no item**; only the parent model's text mentions it.
- **V1 parent thread:** `collabAgentToolCall {tool: "spawnAgent", senderThreadId, receiverThreadIds, prompt, model, reasoningEffort, agentsStates}`; the `wait` item carries each child's status and final message.
- **Children:** no `thread/started` notification, but connections auto-subscribe to new threads (`app-server/src/lib.rs:1282-1300`). Each child's `turn/started`/`completed`, `item/*` and `item/agentMessage/delta` stream with the **child's `threadId`**, grandchildren too. Linkage: the parent's `subAgentActivity.agentThreadId`, or `thread/read`/`thread/list` (`parentThreadId`, `agentNickname`, `agentRole`, `source.subagent.thread_spawn{parent_thread_id, depth, agent_path}`; `thread/list {parentThreadId | ancestorThreadId}` is experimental).
- Token usage is per thread (`thread/tokenUsage/updated`); `account/rateLimits/updated` is account-wide.

### Provider session (verified live)

- Each child is its **own thread with its own rollout file** under `sessions/`, sharing the root's `session_id`.
- **`thread/fork` of the parent works**, full or with `lastTurnId` before the spawn. The fork keeps the past spawn and answer in its history but isn't linked to the children: `list_agents` shows only `/root`, and a `followup_task` to the old child failed with ``live agent path `/root/…` not found``.
- **`thread/revert {beforeTurnId}`** works on the parent (`thread/rollback` no longer exists in 0.160.1). The child thread and its file stay, still listed under the parent.
- **`thread/resume`** of the parent in a new app-server process works, and `followup_task` to an old child reloaded it.
- Archiving a parent cascades to its descendants (source: `app-server/src/request_processors/thread_processor.rs:1746-1777`).
- `thread/inject_items` on a thread with subagents: not tested.

### Usage

- Docs: "Because each subagent does its own model and tool work, subagent workflows consume more tokens than comparable single-agent runs." No subagent-specific quota.
- The Plus account reported one `codex` limit with a weekly window (`windowDurationMins: 10080`), no per-thread split (verified live). Children draw from the same pool (inferred).
- The main cost driver is the V2 full-history fork: each child re-reads the whole Thread uncached.

### Stop

- **`turn/interrupt` on the parent does not stop children.** The parent turn ended `interrupted` while the child kept streaming (47 deltas at the interrupt, 1,329 deltas 20 s later) and then completed (verified live). Source agrees: `Session::interrupt_task` only aborts the session's own tasks (`core/src/session/mod.rs:5054`).
- The child's `subAgentActivity kind: "completed"` then arrived on the parent thread **tagged with the parent turn's id, after that turn had ended**. No new parent turn started within 20 s (verified live).
- `turn/interrupt {threadId: child, turnId}` stops a child (verified live). So Stop must interrupt the parent and every running descendant, tracked per `threadId` from `turn/started`.

### Side note for the plain-Tree lockdown

With `environments: []`, the Models still reported `functions.exec` and `functions.wait` (code mode), and gpt-5.6-luna and gpt-6.1-sol listed many `mcp__codex_apps__*` connector tools and `web__run`. Not investigated here; relevant to [Capability tiers and system prompts](https://github.com/qodesmith/unimatrix-zero/issues/9).

---

## What this means for Subagents in every Tree

- **Plain Trees can have subagents without losing the lock.** Claude: `tools: ['Agent', 'WebSearch']`. Codex: leave the collaboration tools on with `environments: []`; children inherit the empty environment.
- **The Codex "off" switch from #9 is wrong.** If a Tree has subagents off, Codex needs `agents.enabled = false`, not `features.multi_agent = false`. Today every Codex Tree has them on whether or not we decide to offer them.
- **Per-subagent tool limits exist only on Claude.** On Codex a subagent always has what its Tree has. A design that says "subagents get only web search" can only be honoured per Tree on Codex.
- **System prompt differs:** Claude subagents don't see the Tree's System prompt (we write their prompt), Codex children do, plus Codex's own multi-agent text even under a custom `baseInstructions`.
- **Keep everything inside one Reply.** On Claude, run subagents in the foreground only (`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1`); background ones start extra turns with no Prompt and, in a Workspace, could write after the Snapshot. Also set `CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS=1` so the model can only spawn the agents we define. Codex has no foreground mode; a Reply can only be called finished once the parent turn and every child turn have completed.
- **Stop has to be ours on Codex:** interrupt the parent turn and every running child turn. On Claude, a foreground-only setup makes `interrupt()` enough.
- **Approvals already route.** Both Providers send a subagent's approval to the app with an id saying which subagent asked, so the inline approval card can name it.
- **Rendering:** both streams give enough to draw a subagent's work inside the Reply and link it to the call that started it. Claude gives whole messages (no token deltas); Codex gives full deltas per child thread, but on V2 the task text the parent wrote is encrypted.
- **Forks and rewinds keep working** on both: what the parent learned lives in the parent's session. A fork can't talk to an earlier subagent again, which matters only if follow-ups to finished subagents are offered.
- **Cost:** a Codex child re-reads the whole Thread uncached by default; a Claude subagent starts small. Both draw on the same plan limits as the parent, and both report per-subagent tokens.
- **Limits to pick:** Claude allows 20 at once and 3 levels deep by default; Codex V2 allows 3 at once and unlimited depth. The app may want its own caps (Claude env vars; Codex `agents.max_threads`).

## Unverified

- Claude: whether Glob/Grep can be added to a subagent whose parent lacks them (the docs say so on macOS; not seen); concurrent writes by several subagents to one working copy; behaviour of `stopTask` on a single foreground subagent; per-subagent usage against the 5-hour window (only totals checked).
- Codex: hooks and hosted web search in a child (inferred from the config clone); whether role files' `sandbox_mode`/`mcp_servers` work (docs yes, source suggests no); MCP-tool approvals from a child (only shell approvals tested); `thread/inject_items` on a thread with subagents; whether a child finishing after Stop can trigger a later parent turn; V1 under `turn/interrupt`; whether the server-side model catalog matches the bundled `models.json`; how much Plus usage subagent tokens cost.
- Both: whether the Models spawn subagents unprompted in practice. Claude's custom-prompt sessions have no "don't delegate" line; Codex's `<multi_agent_mode>` text tells it not to unless asked.

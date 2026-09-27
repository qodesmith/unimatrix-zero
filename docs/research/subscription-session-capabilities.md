# What a subscription-backed session can control

Research for [#2](https://github.com/qodesmith/unimatrix-zero/issues/2), part of the map [#1](https://github.com/qodesmith/unimatrix-zero/issues/1). Researched 2026-09-27.

**Question:** when Unimatrix Zero drives the user's Claude subscription (Claude Agent SDK spawning the `claude` binary) or ChatGPT subscription (Codex, signed in with ChatGPT), with no API key, what can it control? The areas are system prompt, tools, model, session shape, attachments, streaming, concurrency, usage data and terms.

## Sources and method

Versions examined:

| Thing | Version |
| --- | --- |
| `@anthropic-ai/claude-agent-sdk` | 0.3.283 (bundles Claude Code 2.1.283, build 2026-09-25) |
| Local `claude` binary | 2.1.283, `authMethod: "claude.ai"`, `subscriptionType: "max"` |
| `@openai/codex-sdk` | 0.157.1 |
| Local `codex` CLI | 0.157.1, "Logged in using ChatGPT", `planType: "plus"` |
| openai/codex repo | `41f9084b` (2026-09-27) |
| pingdotgg/t3code repo | `de251fc2` (2026-09-27) |

Primary sources:

- Claude Agent SDK type definitions (`sdk.d.ts` in the npm package). They are the most detailed contract and are quoted below as **[sdk.d.ts]**.
- Claude Code docs at `code.claude.com/docs/en/...`, fetched as Markdown on 2026-09-27. The docs pages carry no "last updated" date, so the date given is the retrieval date.
- Codex app-server protocol, generated locally with `codex app-server generate-ts`, plus the Rust source in `codex-rs/app-server-protocol`.
- Codex docs at `developers.openai.com/codex/*`, which now redirect to `learn.chatgpt.com/docs/*`. Fetched 2026-09-27.
- Vendor terms pages: Anthropic Consumer Terms and the OpenAI Terms of Use. openai.com returned 403, so the OpenAI terms were read from a Wayback Machine snapshot taken 2026-09-26.
- T3 Code source under `apps/server/src/provider/`.

**Live tests.** Every claim marked **(verified live)** was run against the real subscription accounts above with throwaway scripts on 2026-09-27. No API key was set: Claude's init message reported `apiKeySource: "none"` and Codex's `account/read` returned `type: "chatgpt"`.

---

## TL;DR

| Capability | Claude (Agent SDK, claude.ai login) | ChatGPT (Codex app-server, ChatGPT login) |
| --- | --- | --- |
| Replace the system prompt | **Yes.** `systemPrompt: "..."` replaces it. The CLI still puts one identity line in front: *"You are a Claude agent, built on Anthropic's Claude Agent SDK."* (verified live) | **Yes.** `baseInstructions` replaces Codex's base prompt, and `developerInstructions` adds to it (verified live) |
| Change the system prompt mid-session | Recorded once per session by default (`snapshot`). Opt out with `snapshot: false` | Can be overridden on `thread/resume` and `thread/fork` |
| No tools (plain chat) | **Yes.** `tools: []` plus `strictMcpConfig: true, mcpServers: {}` plus `settingSources: []` gives zero tools (verified live) | **Not cleanly.** Feature flags removed some tools, but `exec`, `request_user_input` and multi-agent tools remained, going by the model's own report. A read-only sandbox with `approvalPolicy: "never"` limits side effects |
| A subset of tools | Yes. `tools: ["WebSearch", "WebFetch"]`, plus `cwd`, `additionalDirectories` and permission rules | Partly. `webSearchMode`, `sandbox` (`read-only`/`workspace-write`), `cwd`, `additionalDirectories`, feature flags |
| List models | `query.supportedModels()` (verified live) | `model/list` (verified live) |
| Change model per Prompt | Yes: `setModel()` mid-session, or `model` on resume (verified live) | Yes: `turn/start.model` applies to this turn and later ones (verified live) |
| Resume a session | `resume: sessionId` | `thread/resume` |
| Fork at an earlier Reply | **Yes.** `resume` + `resumeSessionAt: <assistant uuid>` + `forkSession: true`, or `forkSession(id, { upToMessageId })` (verified live) | **Yes.** `thread/fork { threadId, lastTurnId }` (verified live) |
| Seed from an arbitrary transcript | **No supported API.** Transcript entries are documented as opaque | **Yes.** `thread/inject_items` with raw Responses API items (verified live). `thread/resume.history` also exists but is experimental |
| Images in a Prompt | Yes, base64 `image` blocks (verified live) | Yes: `image` (URL) and `localImage` (path) |
| Files and PDFs in a Prompt | Yes: `document` blocks for base64 PDF and plain text (verified live) | No file input type. Save to disk and reference by path; the agent then needs a read tool |
| Token streaming | `includePartialMessages: true` gives `stream_event` deltas (verified live) | `item/agentMessage/delta` notifications (verified live) |
| Several sessions at once | Yes, one CLI process per `query()` (4 in parallel, verified live) | Yes, many threads in one `app-server` process (3 in parallel, verified live) |
| Usage and rate limits | `rate_limit_event` stream (5-hour and 7-day utilization), plus an experimental `get_usage` (verified live) | `account/rateLimits/read` and the `account/rateLimits/updated` notification (verified live) |
| Terms | **Contradictory wording** (see below). The Agent SDK docs forbid offering claude.ai login. The legal page allows an end user to sign in to the *unmodified* `claude` binary, but "running Claude Code in your products" requires the Commercial Terms | No explicit third-party-app clause found. The app-server is documented for "deep integration inside your own product", including ChatGPT login |

---

## Claude: Agent SDK on a claude.ai subscription

### How it runs

The SDK spawns the Claude Code CLI as a subprocess. `pathToClaudeCodeExecutable` points it at a specific binary. The npm package also pulls in a platform binary as an optional dependency (`@anthropic-ai/claude-agent-sdk-darwin-arm64`), which matters for the terms section. T3 Code passes the user's own configured `claude` path (`apps/server/src/provider/Drivers/ClaudeExecutable.ts`, `ClaudeAdapter.ts:4904`). It never bundles one.

Authentication is whatever the binary has stored. Precedence per [Authentication](https://code.claude.com/docs/en/authentication.md): API key env vars come first, and "Subscription OAuth credentials from `/login`" is the default for Pro/Max/Team/Enterprise. Strip `ANTHROPIC_API_KEY` from the `env` option so an ambient key can't silently switch billing. The SDK's `env` replaces the subprocess environment entirely [sdk.d.ts `Options.env`].

### System prompt

[sdk.d.ts `Options.systemPrompt`] accepts:

- a string, `string[]`, or `{ type: 'custom', prompt, snapshot? }`, which is a full replacement;
- `{ type: 'preset', preset: 'claude_code', append?, excludeDynamicSections?, snapshot? }`.

Docs ([Modifying system prompts](https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts.md)): "You can provide a custom string as `systemPrompt` to replace the default entirely with your own instructions." If `systemPrompt` is left unset, the SDK uses "a minimal prompt that covers tool calling but omits the rest of the `claude_code` preset's content".

**Under subscription auth (verified live):** a custom prompt (`"You are Zorp, a pirate… secret word is PAPAYA"`) on Haiku 4.5 was fully honored. Asked to quote the first sentence of its system prompt, the model replied `"You are a Claude agent, built on Anthropic's Claude Agent SDK."` So the CLI prepends one identity line to custom prompts, and the rest is ours. The same three identity strings appear in the 2.1.283 binary: "You are Claude Code, Anthropic's official CLI for Claude.", "...running within the Claude Agent SDK.", and "You are a Claude agent, built on Anthropic's Claude Agent SDK." Nothing in the docs or types restricts custom prompts on OAuth. **No evidence of a subscription restriction on custom system prompts.**

**Snapshot semantics (documented, not tested):** by default the rendered system prompt "is recorded once (in the session transcript) and reused verbatim on every later request and `resume` / `continue`… a different `append` or `prompt` passed on a later launch of the same session is ignored until compaction or a new session." `snapshot: false` renders it fresh on every request. A Fork therefore inherits its parent's system prompt unless it is created with `snapshot: false` [sdk.d.ts]. The docs also say recording "is rolling out", and that where it isn't enabled, `snapshot` has no effect.

### Tools

- `tools: []` disables all built-in tools [sdk.d.ts `Options.tools`: "`[]` (empty array) - Disable all built-in tools"]. `tools: ['WebSearch', 'WebFetch']` gives a subset. `allowedTools` only auto-approves; it doesn't restrict. `disallowedTools` removes tools from context.
- **Gotcha (verified live):** with only `tools: []`, the init message still listed about 40 `mcp__claude_ai_Gmail__*`, `…Google_Drive__*` and `…Google_Calendar__*` tools. Those are the user's **claude.ai connectors**, pulled in through the login. Adding `strictMcpConfig: true, mcpServers: {}` brought `tools` to `[]`. `settingSources: []` also stops the user's `~/.claude` settings, CLAUDE.md and skills from leaking in.
- File or shell tools scoped to one folder: set `cwd` and `additionalDirectories`, and use permission rules such as `Read(...)`/`Edit(...)` through `canUseTool` or settings. `sandbox` adds OS-level isolation for Bash. See [Configure permissions](https://code.claude.com/docs/en/agent-sdk/permissions.md). Not tested live.

### Models

- `query.supportedModels()` on the **Max** account returned (verified live): `default` (Default (recommended)), `opus` (Opus 5.5), `claude-fable-5-1`, `sonnet` (Sonnet 5), `haiku` (Haiku 4.5), `claude-opus-5`, `claude-fable-5`, `claude-opus-4-8`, `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`.
- By plan ([Model configuration](https://code.claude.com/docs/en/model-config.md)): "Pro, Max, Team, Enterprise, and Anthropic API: defaults to Opus 5.5". "Depending on your plan and seat tier, Fable usage can bill to usage credits instead of drawing on your plan's included limits." On Pro, the 1M-context `[1m]` variants of Opus 4.6 and Sonnet 4.6 need usage credits. **The Pro model list was not verified live.** Read `supportedModels()` at runtime rather than hard-coding it.
- Changing models: `Query.setModel()` works mid-session in streaming-input mode (Configuration docs). Passing a different `model` on `resume` also works. **Verified live:** a Haiku session resumed with `model: 'sonnet'` answered as `claude-sonnet-5`, and `modelUsage` listed both models. The recorded system prompt doesn't change on a model switch.

### Session shape

- **Resume:** `resume: sessionId`. Transcripts are stored as JSONL at `~/.claude/projects/<encoded-cwd>/<id>.jsonl`, so resume depends on `cwd` ([Sessions](https://code.claude.com/docs/en/agent-sdk/sessions.md)).
- **Fork at an earlier Reply (verified live):** turn 1 said "favorite color TEAL" and turn 2 said "favorite animal OTTER". Resuming with `resumeSessionAt: <last assistant uuid of turn 1>, forkSession: true` produced a new session id that knew TEAL and answered UNKNOWN for the animal. The original session was unchanged.
  - [sdk.d.ts `resumeSessionAt`]: "Accepts any chain-entry UUID". `resumeDropsTurn` guards against dropping unexpected entries. The pair only works in "PRINT/HEADLESS LANE ONLY", which is the SDK lane.
  - There is also a standalone `forkSession(sessionId, { upToMessageId, title })` that copies a transcript up to a message without running a turn. T3 Code uses it for rollback (`ClaudeAdapter.ts:5400-5470`).
  - One Reply can span several `SDKAssistantMessage`s. The CLI "emits one assistant message per completed content block". A Reply's fork point is the **last** assistant uuid of that turn, and one Reply gave two uuids in the live test.
  - T3 Code refuses rollback when "The exact Claude turn boundary is unavailable, possibly after compaction". After auto-compaction, early fork points may be gone ("After auto-compaction, earlier turns are replaced by a summary", [Session storage](https://code.claude.com/docs/en/agent-sdk/session-storage.md)).
- **Seed from an arbitrary transcript:** **not supported.** The only paths are resume or fork of a session the CLI wrote, or a `SessionStore` adapter (`append`/`load`) to mirror transcripts. The docs say to "Treat them as opaque JSON-safe values", so hand-built entries are unsupported. The fallback is replaying a Thread as text in the first Prompt, which loses the real turn structure. (Also relevant to the cross-provider research branch.)
- **Storage:** every fork is a full transcript copy under `~/.claude/projects/`. A `sessionStore` option lets the host mirror transcripts to its own database.

### Attachments (verified live)

A streaming-input `SDKUserMessage` with Messages-API content blocks worked in one Prompt:

- a base64 `image` block;
- a base64 `document` PDF block (the model read "HELLO KIWI");
- a `document` block with `source: { type: 'text' }` (the model read "MANGO-42").

T3 Code only sends images inline. Other files go to disk and their path is put in the prompt (`ClaudeAdapter.ts:1620`).

### Streaming and concurrency

- `includePartialMessages: true` yields `stream_event` partials (verified live: 17 events on a short reply).
- Four `query()` calls ran in parallel with no problem (verified live, about 1.5-1.8 s each). Each `query()` is its own CLI process.

### Usage and rate limits (verified live)

- **`rate_limit_event`** is streamed during a turn:
  `{ status: "allowed", rateLimitType: "five_hour", resetsAt, overageStatus, unifiedWindows: { five_hour: { utilization: 0.1, resetsAt }, seven_day: { utilization: 0.02, resetsAt } } }`.
- **`query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`** (the `get_usage` control request) returned `rate_limits_available: true` with:
  - `five_hour` and `seven_day` utilization (0-100) and ISO `resets_at`;
  - a `limits[]` list (`session`, `weekly_all`, and `weekly_scoped` for Fable);
  - `model_scoped`, `extra_usage` and `spend`;
  - a `seven_day_breakdown` split into Claude Code / Chats / Cowork.

  It also has a `seven_day_oauth_apps` field (null here). Its meaning is undocumented. **Not verified**, but it hints at a separate bucket for OAuth apps. [sdk.d.ts]: `rate_limits_available` is "False when plan rate limits do not apply (API key, Bedrock, Vertex, or missing profile scope)".
- Result messages carry `total_cost_usd` and `modelUsage`. That cost is an API-price estimate, not what the subscriber is billed.
- T3 Code joins the two sources in `apps/server/src/provider/Layers/claudeUsageLimits.ts`.

---

## ChatGPT: Codex signed in with ChatGPT

### Two integration surfaces

- **`@openai/codex-sdk`** wraps `codex exec` [dist/index.d.ts]. It offers `startThread`, `resumeThread`, `run` and `runStreamed`, and `UserInput` is text or `local_image`. It has **no fork, no instructions parameter, no model list and no rate limits**; the only escape hatch is raw `config` overrides. Streaming is item-level, not token deltas.
- **`codex app-server`** (JSON-RPC over stdio). Docs: "Codex app-server is the interface Codex uses to power rich clients (for example, the Codex VS Code extension). Use it when you want a deep integration inside your own product: authentication, conversation history, approvals, and streamed agent events." ([App Server](https://developers.openai.com/codex/app-server), fetched 2026-09-27). **T3 Code uses app-server**, through `packages/effect-codex-app-server`. Caveat, quoted from the same page in its remote-connection section: "The app-server command and WebSocket transport are experimental and aren't supported for production workloads." Some methods, such as `plugin/*`, are marked "Don't call this method from production clients yet."

Everything below refers to app-server.

### System prompt

`thread/start`, `thread/resume` and `thread/fork` accept `baseInstructions` (replaces Codex's base prompt) and `developerInstructions` (a developer message). **Verified live on ChatGPT Plus:** `baseInstructions` = the pirate "Zorp / PAPAYA" prompt was fully honored on `gpt-5.6-sol`. **No evidence of a subscription restriction.**

### Tools

There is no single "no tools" switch.

- Tried `web_search: "disabled"` plus `features.{shell_tool, unified_exec, apply_patch_freeform, view_image, js_repl, code_mode, multi_agent, multi_agent_v2, apps, memories, tool_search, image_generation, goals, collaboration_modes, default_mode_request_user_input, plugins, browser_use, computer_use}=false`.
- The model then listed only `functions.exec`, `functions.wait`, `functions.request_user_input` and `collaboration.*`. Without the extra flags it had also listed `apply_patch`, the goal tools and `image_gen`.
- **Caveat:** this rests on the model reporting its own tools; the request payload wasn't inspected.
- For plain chat, combine `sandbox: "read-only"`, `approvalPolicy: "never"` and declining any server approval request, with instructions telling the model not to use tools.
- Scoping: `cwd`, `additionalDirectories`, `sandbox`/`sandboxPolicy`, and `webSearchMode` (`disabled`, `cached`, `live`).
- T3 Code doesn't try for tool-less chat either.

### Models

- `model/list` on **Plus** (verified live): `gpt-6-astra` (default), `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` and `gpt-5.5`. All take text and image input and have per-model reasoning efforts.
- The Pricing page lists these plus GPT-5.4 and GPT-5.4 mini, with "local messages per five-hour period" estimates per plan (Plus, Pro 5x, Pro 20x, Business). For example, GPT-6 Astra is 5-45 on Plus and 100-900 on Pro 20x. It also says "Weekly limits may also apply" and "ChatGPT uses the same pricing, credits, and usage limits as Codex."
- Per-turn switch: `turn/start.model` means "Override the model for this turn and subsequent turns". **Verified live:** switching to `gpt-6-luna` mid-thread worked. `effort` can also be set per turn.

### Session shape

- **Resume:** `thread/resume { threadId }`. Threads live in `~/.codex/sessions`.
- **Fork at an earlier Reply (verified live):** `thread/fork { threadId, lastTurnId: <turn 1 id> }` produced a thread that knew TEAL and answered UNKNOWN for OTTER. Docs: "Pass lastTurnId to copy history through that turn and omit later turns, or ephemeral: true to create an in-memory fork." A turn that is still running is rejected.
- **Rewind in place:** `thread/revert { threadId, beforeTurnId }` ("does not revert local file changes"). `thread/rollback` has been removed. T3 Code uses `thread/revert` (`CodexSessionRuntime.ts:1294`).
- **Seed from an arbitrary transcript (verified live):** `thread/inject_items` with `[{type:"message", role:"user", content:[{type:"input_text", ...}]}, {type:"message", role:"assistant", content:[{type:"output_text", ...}]}]` on a fresh thread worked; the next turn answered "Your dog is named **BISCUIT**." Docs: "append raw Responses API items to a loaded thread's model-visible history without starting a user turn." There is also an experimental `thread/resume.history`, gated behind `experimentalApi`.

### Attachments

`UserInput` = `text`, `image` (`url` or `fileId`), `localImage` (path), `audio`/`localAudio`, `skill` or `mention`. There is **no document or PDF input**. `thread/attachment/*` records resources linked to a thread, such as PRs, and does not add model input. Files have to be written to disk and referenced by path, and the agent needs a read-capable tool to open them. That clashes with "no tools" mode unless the file text is pasted into the Prompt.

### Streaming and concurrency (verified live)

- `item/agentMessage/delta` notifications (94 deltas on one reply), plus reasoning-summary deltas, `turn/completed` and `thread/tokenUsage/updated`.
- Three threads in one `app-server` process ran turns concurrently. All completed, and `thread/loaded/list` reported 3. Notifications carry `threadId`.

### Usage and rate limits (verified live, Plus)

- `account/rateLimits/read` returned `rateLimits.primary = { usedPercent, windowDurationMins: 10080, resetsAt }` with `secondary: null`, plus `credits`, `planType: "plus"` and `rateLimitResetCredits`. This account had 3 unused "Full reset" credits.
  - **Only a weekly window was reported on this Plus account, not a 5-hour one**, even though the Pricing page talks in five-hour estimates. Don't hard-code two windows.
- The `account/rateLimits/updated` notification arrives during turns.
- `account/usage/read` gives token-activity summaries.
- T3 Code: `apps/server/src/provider/Layers/codexUsageLimits.ts`.

### Sign-in without a terminal

- `account/login/start` takes `type: "chatgpt"` (browser flow), `"chatgptDeviceCode"`, `"apiKey"`, or experimental `"chatgptAuthTokens"`. Docs: "ChatGPT managed (`chatgpt`) - Codex owns the ChatGPT OAuth flow, persists tokens, and refreshes them automatically."
- A host app can therefore start ChatGPT sign-in from its own UI, with Codex (not the app) owning the tokens.
- Claude has no SDK-level login call. The CLI offers `claude auth login [--claudeai] [--email]`, and the SDK only emits `auth_status` messages. T3 Code tells users to run `claude auth login` in a terminal (`Drivers/ClaudeHome.ts:89`). The research branch `research/hidden-sign-in` covers this in depth.

---

## Terms (exact text)

### Anthropic

**Agent SDK overview**, <https://code.claude.com/docs/en/agent-sdk/overview.md>, retrieved 2026-09-27:

> Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the [Quickstart](/docs/en/agent-sdk/quickstart) instead.

**Legal and compliance**, <https://code.claude.com/docs/en/legal-and-compliance.md>, retrieved 2026-09-27.

"Can customers offer Claude Code in their products?":

> Unless we've mutually agreed otherwise, preinstalling or running Claude Code in your products or services (e.g. in hosted sandboxes or other agent infrastructure) requires agreeing to our [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) and complying with the conditions below:
>
> * **The Claude Code binary must not be modified.** Claude Code must be installed and run as published by Anthropic, and customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key).
> * **Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.** Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential (Amazon Bedrock, Google Cloud's Agent Platform, Microsoft Foundry). That usage is billed directly to the end user under their own agreement with Anthropic or, for third-party inference providers, with the applicable provider.

"Acceptable use":

> Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK.

"Authentication and credential use":

> * **OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications. […]
> * **Developers** building products or services that interact with Claude's capabilities, including those using the [Agent SDK](/docs/en/agent-sdk/overview), should use API key authentication through [Claude Console](https://platform.claude.com/) or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow.
>
> This does not restrict how customers provision and manage their own API keys or third-party inference provider credentials […] Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under *Can customers offer Claude Code in their products?* above.
>
> Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice.

**Consumer Terms** (Free/Pro/Max), <https://www.anthropic.com/legal/consumer-terms>, "Effective October 8, 2025", retrieved 2026-09-27:

> You may not share your Account login information, Anthropic API key, or Account credentials with anyone else.

> Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it, to access the Services through automated or non-human means, whether through a bot, script, or otherwise.

(This is one of the prohibited uses.)

### OpenAI

**Terms of Use**, <https://openai.com/policies/row-terms-of-use/>, "Published: January 1, 2026 … Effective: January 1, 2026". openai.com returned 403, so this was read from the Wayback snapshot of 2026-09-26:

> You may not share your account credentials or make your account available to anyone else and are responsible for all activities that occur under your account.

> What you cannot do. […] Automatically or programmatically extract data or Output (defined below). […] Interfere with or disrupt our Services, including circumvent any rate limits or restrictions or bypass any protective measures or safety mitigations we put on our Services.

**Codex docs** (fetched 2026-09-27):

- App Server: "Use it when you want a deep integration inside your own product: authentication, conversation history, approvals, and streamed agent events."
- Codex SDK: "Use the Codex app server to build custom clients that handle authentication, conversation history, approvals, and streamed agent events."
- The Codex CLI and app-server are Apache-2.0 (`openai/codex/LICENSE`).

**No OpenAI page found that addresses third-party apps using a ChatGPT login through Codex, either to permit or to forbid it.** An OpenAI blog or staff statement couldn't be located on a primary source (**unverified**).

### How T3 Code fits

- T3 Code **does not ship or modify** Claude Code or Codex. Its README says: "Install and authenticate at least one provider before use: Codex: install Codex CLI and run `codex login`; Claude: install Claude Code and run `claude auth login`."
- It points the SDK at the user's own binary (`pathToClaudeCodeExecutable`), never touches credentials, and sign-in happens in the vendor's own CLI flow.
- That matches the legal page's carve-out: "an end user … signing in to the unmodified Claude Code binary with their own Claude subscription". It also stays clear of "collect, store, or intermediate Claude.ai credentials".
- It is still an Agent SDK product whose users sign in with claude.ai, which the overview note literally forbids "unless previously approved". **Whether T3 Code has approval is unverified.** The map's belief that Anthropic considers this acceptable could not be confirmed from a primary source.
- For Codex, T3 uses app-server, the documented "deep integration inside your own product" surface.

---

## Implications for Unimatrix Zero

1. **Custom system prompts are possible on both providers.** Claude always adds one identity sentence in front, and the recorded system prompt makes changes within a session sticky. Plan for "a Tree's Threads share one system prompt", or create every Fork with `snapshot: false`.
2. **Claude can do tool-less plain chat; Codex can't cleanly.** Codex "plain chat" means an agent in a read-only sandbox whose tools are restricted as far as possible. This affects capability tiers.
3. **Forking at any Reply works on both.** This makes the provider session a good backing store for a Branch, with some caveats:
   - Claude's fork point is the last assistant-message uuid of a Reply, not the first.
   - Compaction can erase early fork points.
   - Every Fork duplicates the transcript on disk in the vendor's own directory.
   - Unimatrix's SQLite Tree should stay the source of truth. Provider sessions are rebuildable caches, keyed per Branch head.
4. **Switching models per Prompt works on both.** **Switching provider mid-Tree** needs transcript seeding. Codex supports that (`thread/inject_items`); Claude has no supported way, so a Branch moving *to* Claude has to replay history as text.
5. **Attachments are uneven.** Claude takes images, PDFs and text documents inline. Codex takes images inline, and anything else only by path through tools.
6. **Rate-limit display needs a per-provider shape.** Claude has 5-hour and 7-day windows plus model-scoped weeklies. The Codex Plus account showed only a weekly window. Both push updates during turns.
7. **Isolate from the user's own CLI setup.**
   - Claude pulls in claude.ai connectors (Gmail/Drive/Calendar) and `~/.claude` settings unless `strictMcpConfig: true, mcpServers: {}, settingSources: []` are set.
   - Codex reads `~/.codex/config.toml`.
   - Sessions also appear in the user's own Claude Code / Codex history, so use a dedicated `cwd`.

## Unverified or open

- Whether Anthropic's "unless previously approved" overview note applies to a free desktop app that drives the user's own unmodified `claude` binary, and whether T3 Code has approval. This needs a legal reading or a direct question to Anthropic.
- Whether *installing* Claude Code for the user, or depending on the SDK's bundled platform binary, counts as "preinstalling or running Claude Code in your products", which requires the Commercial Terms.
- The exact tools Codex sends when feature flags are off (only the model's self-report was checked).
- The Claude model list on **Pro** (only Max was observed) and the Codex model list on Pro.
- What `seven_day_oauth_apps` in Claude's `get_usage` means.
- Whether `snapshot` is actually active for the test account, which would make a changed system prompt on resume be ignored. It was not tested.
- Claude path-scoped file permission rules were not tested live.

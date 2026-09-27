# AI library landscape for CLI-backed providers

Research for [#6](https://github.com/qodesmith/unimatrix-zero/issues/6), part of the [v1 spec map (#1)](https://github.com/qodesmith/unimatrix-zero/issues/1). Checked on 2026-09-27 against npm tarballs, official docs, GitHub source, and a clone of T3 Code (`pingdotgg/t3code` at `de251fc`, 2026-09-27). Each claim cites its source. Anything marked **Unverified** was not confirmed.

## Question

Which AI libraries actually help when the "model" is a local CLI-backed agent (the Claude Agent SDK driving `claude`, or Codex) rather than an HTTP model API? What is the thinnest stack that solves real problems?

## TL;DR

- **The agent loop belongs to the CLI, not to us.** Claude Code and Codex run their own tools, thinking, permissions and sessions. For us, an "AI library" can only (a) wrap the CLI stream into its own chunk format, and (b) give the renderer a `useChat`-style store. It can't provide tool loops, retries or provider switching, because none of those are ours to run.
- **What T3 Code does:** it integrates the SDKs directly. It uses `@anthropic-ai/claude-agent-sdk` and its own typed client for `codex app-server`, then maps both into one in-house event schema. It uses **no** AI SDK and **no** TanStack AI. It renders with `react-markdown` + Shiki, plus its own incremental-parse plugin.
- **Recommendation:** the thinnest stack is direct SDK integration.
  - In the main process, use `@anthropic-ai/claude-agent-sdk` for Claude and `codex app-server` over JSON-RPC for ChatGPT (not `@openai/codex-sdk`).
  - Map both into one small typed Turn/Reply event union, and stream it over Electron IPC.
  - In the renderer, keep a plain store keyed by Tree/Turn.
  - Render with the library-agnostic shadcn components (MessageScroller, Message, Bubble, Attachment, Marker) and a streaming-safe markdown renderer.
- **Where TanStack fits:** TanStack AI is the one library worth prototyping against, because it ships official `@tanstack/ai-claude-code` and `@tanstack/ai-codex` adapters and a client that takes a custom (IPC) connection. But it is RC/0.x, releases very often, and its Codex adapter wraps `codex exec` (no token deltas, no approvals). Its message model is a single linear list, which doesn't fit a branching Tree. Not recommended for v1.
- **Markdown:** TanStack Markdown is alpha (0.0.15), not full GFM, and uses its own highlighter. Streamdown (streaming-safe, Shiki) is the pragmatic default. T3's react-markdown + Shiki approach works but cost them a ~3,400-line component.
- **Policy blocker to resolve first:** Anthropic's Agent SDK docs say third-party developers may not "offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK" unless previously approved. See [Risks](#risks-and-surprises).

## 1. What a CLI-backed provider changes

With an HTTP model API, libraries like the AI SDK or TanStack AI own the tool-call loop, the message history they resend, and the provider abstraction. With a CLI agent:

- **Tool calls:** the CLI executes them itself. Libraries surface them as provider-executed or already-resolved tool parts ([ai-sdk-provider-codex-cli README](https://www.npmjs.com/package/ai-sdk-provider-codex-cli): "all tool calls are `providerExecuted: true`"; TanStack `ai-claude-code` `translate.d.ts` emits `TOOL_CALL_*` + `TOOL_CALL_RESULT` and always finishes with `stop`).
- **History:** the CLI persists it as sessions or threads, so the library does not resend it. Branching is done by the CLI's fork API (section 4), not by editing a message array.
- **Permissions:** approvals come through a CLI-specific callback (`canUseTool`) or JSON-RPC server requests, not a generic tool-approval flow. ai-sdk-provider-claude-code's README says AI SDK `toolApproval` is not wired to Claude's permissions.

So any library's value here comes down to its **stream-chunk format, its client state hook, and its UI message shape**.

## 2. TanStack AI

- **Maturity:** versions are `@tanstack/ai@0.61.0`, `@tanstack/ai-client@0.35.1` and `@tanstack/ai-react@0.29.1` (npm). tanstack.com marks the library **RC** (`badge: 'RC'` in [libraries.ts](https://github.com/TanStack/tanstack.com/blob/main/src/libraries/libraries.ts)). 0.1.0 came out on 2025-12-19 and the latest is 0.61.0, so the API churns heavily.
- **Adapter interface** (`@tanstack/ai@0.61.0`, `dist/esm/activities/chat/adapter.d.ts`):
  - `TextAdapter` has `kind: 'text'`, `name` and `model`, a `chatStream(options): AsyncIterable<AdapterYieldChunk>` method, and `structuredOutput(...)`. An abstract `BaseTextAdapter` is also provided.
  - Chunks follow the **AG-UI** event protocol (`StreamChunk = AGUIEvent`): `RUN_*`, `TEXT_MESSAGE_START/CONTENT/END`, `REASONING_*`, `TOOL_CALL_START/ARGS/END/RESULT`, `STEP_*`, `CUSTOM`, `STATE_*`, `SUBAGENT_*`.
- **UI message:** `{ id, role, parts }`. Part types are `text`, `tool-call` (with `state` and `approval`), `tool-result`, `thinking`, `image`/`audio`/`video`/`document`, `structured-output`, `subagent` and `ui-resource` (`types.d.ts`).
- **Existing CLI adapters:** `@tanstack/ai-claude-code@0.6.12` and `@tanstack/ai-codex@0.5.12`, both created 2026-06-30 (npm). Each needs `@tanstack/ai-sandbox` plus a sandbox provider such as `@tanstack/ai-sandbox-local-process` ("no isolation").
  - `ai-claude-code` has `authMode: 'host' | 'api-key'`, where host means the local `claude` login. The default is `api-key`. The session id arrives as a `CUSTOM` `claude-code.session-id` event and goes back in via `modelOptions.sessionId` / `forkSession`.
  - The published 0.6.12 **does not import the Agent SDK**, despite what the docs say. It generates a runner script that spawns `claude --output-format stream-json` (`dist/esm/adapters/claude-run-source.js`).
  - The docs on `main` list `canUseTool` and `pathToClaudeCodeExecutable`, but the 0.6.12 types don't have them ([docs/adapters/claude-code.md](https://github.com/TanStack/ai/blob/main/docs/adapters/claude-code.md)).
  - `ai-codex` wraps `codex exec --experimental-json`, so it has **no token deltas and no interactive approvals** (see section 4).
- **Client over IPC: yes.** `@tanstack/ai-client@0.35.1` `ConnectionAdapter` is either `connect(messages, data?, abortSignal?) => AsyncIterable<StreamChunk>` or `subscribe()` + `send()`. The `stream(factory)` and `rpcStream(rpcCall)` helpers take any async iterable, so an Electron IPC bridge fits without HTTP.
- **What it buys us:** a ready-made chunk vocabulary (AG-UI), `useChat` state for one linear conversation, and two harness adapters we could use or copy.
- **What it doesn't:** Tree-shaped state (`useChat` is one linear message list, and we need many concurrent Threads over a shared Tree); a stable API; Codex streaming. The Claude adapter also bypasses the Agent SDK, so we'd lose `canUseTool`, `getSessionMessages`, `forkSession` and usage and rate-limit events unless the adapter grows them.

## 3. Vercel AI SDK

- **Versions:** `ai@7.0.118` (v7.0.0 on 2026-06-25) and `@ai-sdk/react@4.0.121` (npm).
- **Transport:** `useChat({ transport })` takes a `ChatTransport` with two methods: `sendMessages({ trigger, chatId, messageId, messages, abortSignal, ... }) => Promise<ReadableStream<UIMessageChunk>>` and `reconnectToStream({ chatId }) => ...` (`ai@7.0.118` `dist/index.d.ts`). An IPC-backed transport is easy to write. `DirectChatTransport` runs an in-process `Agent`, so it applies to the main process only.
- **UIMessage:** `{ id, role, metadata?, parts }`.
  - Part types: `text`, `reasoning`, `file`, `tool-${name}` / `dynamic-tool`, `data-${name}`, `source-*`, `step-start`.
  - Tool states run from `input-streaming` through `approval-requested`/`approval-responded` to `output-available`/`output-error`/`output-denied`. `providerExecuted?: boolean` marks tools the CLI ran.
- **Community providers** (all listed under [ai-sdk.dev community providers](https://ai-sdk.dev/providers/community-providers/claude-code) except the last):

  | Package | Wraps | Notes |
  |---|---|---|
  | `ai-sdk-provider-claude-code@4.3.2` (benvargas) | Agent SDK 0.3.278 | Supports resume, `forkSession` and `resumeSessionAt`. Tools arrive as provider-executed dynamic tool parts. `canUseTool` needs streaming input, and AI SDK tool approval is not wired. Images only as base64, no PDFs. |
  | `ai-sdk-provider-codex-cli@2.3.0` (benvargas) | `codex exec` or `codex app-server` | Exec mode has no incremental text. App-server mode streams deltas and approvals. |
  | `ai-sdk-provider-codex-app-server@1.1.7` (pablof7z) | app-server | Mid-run injection. |
  | `ai-sdk-provider-codex@0.1.1` | Responses API with `~/.codex/auth.json` | Not listed; README says "written by AI". Avoid. |

- **What it buys us:** the most mature `useChat` and `UIMessage` model, and compatibility with **AI Elements** (typed against `UIMessage`, `ToolUIPart` and so on, and uses Streamdown).
- **What it doesn't:** it is still a linear chat model. The providers are third-party wrappers pinned to specific SDK versions, which adds another layer that can lag behind the CLI. It isn't TanStack. It gives us nothing a CLI provider needs beyond the message types.

## 4. Direct integration

**Claude:** `@anthropic-ai/claude-agent-sdk@0.3.283` (`sdk.d.ts`).
- `query({ prompt: string | AsyncIterable<SDKUserMessage>, options })` returns an `AsyncGenerator<SDKMessage>`.
- Messages include `assistant`, `user`, `result` (success/error subtypes), `system/init`, `stream_event` (token deltas with `includePartialMessages`), `rate_limit_event` and `auth_status`.
- Controls: `interrupt()`, `setModel()` and `setPermissionMode()`, plus `canUseTool(toolName, input, ctx) => allow|deny`.
- **Branching is native:**
  - `forkSession(sessionId, { upToMessageId })` slices the transcript up to a message uuid ("Slice transcript up to the message whose `uuid` field equals this value (inclusive)").
  - `query` options `resume` + `forkSession: true` + `resumeSessionAt: <uuid>` do the same at query time.
  - T3 Code uses both (`apps/server/src/provider/Layers/ClaudeAdapter.ts`).

**ChatGPT:** use **`codex app-server`**, not `@openai/codex-sdk`.
- `@openai/codex-sdk@0.157.1` spawns `codex exec --experimental-json` once per turn. Its events are `item.started/updated/completed`, `turn.*` and so on, but it streams **no token deltas** and auto-rejects approvals (`codex-rs/exec/src/lib.rs` at `rust-v0.157.1`).
- [`codex app-server`](https://developers.openai.com/codex/app-server.md) is JSON-RPC over stdio. OpenAI's docs describe it as the interface for custom clients. It offers:
  - `thread/start`, `resume` and `fork`
  - `turn/start`, `steer` and `interrupt`
  - `item/agentMessage/delta` streaming
  - approvals as server requests
  - ChatGPT login via `account/login/start`
  - `codex app-server generate-ts` for version-matched types
- **Branching is native:** `thread/fork` takes `lastTurnId` ("Optional last turn id to fork through, inclusive"). It also accepts `baseInstructions` and `developerInstructions`, which matters for the custom-system-prompt wish. Source: T3's generated schema `packages/effect-codex-app-server/src/_generated/schema.gen.ts`.

**What direct integration costs:** we write two mappers (SDK message → our event, app-server notification → our event), an IPC bridge and a renderer store. T3 shows the size of this at full feature depth: `ClaudeAdapter.ts` is 5.6k lines and `CodexAdapter.ts` + `CodexSessionRuntime.ts` are 5.5k. That covers far more (skills, subagents, MCP, diffs, many providers) than a chat app needs. **What it buys us:** full access to fork, resume, permissions, usage limits and interrupts, with no layer to lag behind the CLIs.

## 5. What T3 Code actually uses

From `pingdotgg/t3code@de251fc`:

| Concern | T3 Code choice | Source |
|---|---|---|
| Claude | `@anthropic-ai/claude-agent-sdk@^0.3.276`, `query()` with an async-iterable prompt, `forkSession` + `resumeSessionAt` | `apps/server/package.json`, `ClaudeAdapter.ts` |
| Codex | own Effect-based JSON-RPC client for `codex app-server`, types generated from the schema | `packages/effect-codex-app-server` |
| Event model | own canonical `ProviderRuntimeEvent` union (`turn.started`, `content.delta`, `item.started/updated/completed`, `request.opened`, `account.rate-limits.updated`, ...) | `packages/contracts/src/providerRuntime.ts` |
| AI SDK / TanStack AI | **none** (no `ai`, `@ai-sdk/*`, `@tanstack/ai*` imports) | grep over `apps/`, `packages/` |
| Transport | Electron spawns a Node backend (`ELECTRON_RUN_AS_NODE`) and the renderer talks to it over WebSocket, because T3 also serves web, mobile and remote clients | `apps/desktop/src/backend/*`, `apps/server/src/ws.ts` |
| Markdown | `react-markdown@10` + `remark-gfm` + `rehype-sanitize`, with a custom incremental parser that caches the closed-fence prefix, and Shiki 4 with incremental highlighting | `apps/web/src/components/ChatMarkdown.tsx` (3,382 lines), `apps/web/src/markdown-incremental.ts` |
| List | `@legendapp/list` (virtualized) | `apps/web/package.json` |
| Usage limits | reads `rate_limit_event` and `get_usage` from the Agent SDK | `apps/server/src/provider/Layers/claudeUsageLimits.ts` |

## 6. Rendering

- **TanStack Markdown**: `@tanstack/markdown@0.0.15`, site badge **alpha**, no runtime dependencies, React entry point `@tanstack/markdown/react`.
  - Its `extensions/streaming` re-parses the accumulated string on each update. Unclosed fences render progressively; unclosed inline syntax stays literal text until it closes.
  - Highlighting comes from `@tanstack/highlight@0.1.0`, not Shiki.
  - It is deliberately not full CommonMark/GFM ([ai-streaming.md](https://github.com/TanStack/markdown/blob/main/docs/guides/ai-streaming.md)).
- **Streamdown**: `streamdown@2.6.0` (Vercel), a drop-in react-markdown replacement.
  - It repairs unterminated markdown via `remend`, and takes `mode: 'streaming'`, `isAnimating` and `caret` props.
  - It has Shiki via `@streamdown/code`, plus mermaid and math plugins. It is not coupled to the AI SDK.
- **react-markdown / marked**: no unterminated-syntax handling. You add `remend` and a highlighter yourself, as T3 did at considerable effort.

**Pick:** Streamdown for v1 (GFM, Shiki, streaming-safe, independent of any chat library). Revisit TanStack Markdown once it leaves alpha, since it's zero-dependency and TanStack-aligned. A spike comparing the two on code-heavy streams is cheap.

## 7. shadcn

- **AI helpers:** [ai-sdk](https://ui.shadcn.com/docs/helpers/ai-sdk) and [tanstack-ai](https://ui.shadcn.com/docs/helpers/tanstack-ai) come from `@shadcn/helpers@0.2.0`. They are a **scripted fake conversation** (`createChat().user().assistant().transport()`) for demos and tests, returning an AI SDK `ChatTransport` or a TanStack `ConnectConnectionAdapter`. They are not a runtime integration.
  - Its peer ranges are `@tanstack/ai >=0.40 <0.41` and `@tanstack/ai-client >=0.20 <0.21`, which exclude today's 0.61/0.35 (`npm view @shadcn/helpers peerDependencies`).
  - Irrelevant unless we adopt one of those libraries, and then only for tests.
- **Components** (base variants, `https://ui.shadcn.com/r/styles/base-nova/<name>.json`) are all **library-agnostic**. None import `ai` or `@tanstack/ai`.
  - `message-scroller`: stick-to-bottom auto-scroll, `scrollAnchor`, preserves scroll on prepend, `useMessageScroller`. No virtualization.
  - `message`: MessageGroup/Message/Avatar/Content/Header/Footer (layout only).
  - `bubble`: visual variants and reactions.
  - `attachment`: states idle/uploading/processing/error/done.
  - `marker`: status lines such as "Thinking...", tool running, date separators.
  - None renders markdown.
- These work equally well with direct integration, TanStack AI or the AI SDK. They fit chat mode directly. Canvas-mode Turns (React Flow nodes) can reuse Message, Bubble and Marker.
- **AI Elements** (`ai-elements@1.9.0`) is the heavier alternative. It is typed against AI SDK `UIMessage`/`ToolUIPart`, so it only pays off if we adopt the AI SDK message model.

## Recommendation: thinnest stack

| Layer | Choice | Why |
|---|---|---|
| Claude driver | `@anthropic-ai/claude-agent-sdk` in the main process (or a utility process) | Native fork at a message uuid, `canUseTool`, usage and rate-limit events, interrupts |
| ChatGPT driver | `codex app-server` JSON-RPC, types from `codex app-server generate-ts` | Only Codex interface with token deltas, approvals, `thread/fork`, custom instructions |
| Event model | our own small union shaped by Turn/Reply (borrow AG-UI or T3 event names) | Needs to carry Tree/Thread ids for several concurrent streams; no library models that |
| Transport | Electron IPC (`MessagePort` or `webContents.send`) | Local only, so no HTTP or WebSocket needed |
| Renderer state | our own store keyed by Tree/Turn (TanStack Store/Query if useful) | `useChat` in either library assumes one linear conversation |
| Markdown | Streamdown (+ `@streamdown/code`) | Streaming-safe, GFM, Shiki |
| UI | shadcn MessageScroller, Message, Bubble, Attachment, Marker | Library-agnostic |

Each skipped abstraction would buy us only: **TanStack AI** a chunk vocabulary and a linear `useChat`; **AI SDK** a mature linear `useChat`/`UIMessage` plus AI Elements. Neither handles branching, concurrent Threads per Tree, subscription usage limits, or CLI permissions. Those are the hard parts, and we'd write them ourselves either way.

If the user wants to lean TanStack anyway, the lowest-risk way is to adopt only the **AG-UI chunk vocabulary** as our IPC event names. That keeps the option to plug in `@tanstack/ai-client` later, without taking a dependency now.

## Risks and surprises

1. **Anthropic policy on claude.ai login.** [Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview.md), line 44: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the Quickstart instead."
   - T3 Code relies on the user's own existing `claude` CLI login and only displays the subscription type (`ClaudeProvider.ts`).
   - Our "users never see a terminal" goal pushes us toward driving login in-app, which reads closer to "offering claude.ai login".
   - This needs its own decision before the provider ADR. **Unverified:** whether T3 Code has approval, and what Anthropic's position on it actually is.
2. **Codex SDK vs app-server.** `@openai/codex-sdk` is not a viable driver for a chat UI: no deltas, no approvals. app-server is the right interface, but it's an experimental, fast-moving protocol, so types should be generated per pinned Codex version.
3. **Both CLIs natively fork at a Turn** (Claude `forkSession`/`resumeSessionAt` by message uuid; Codex `thread/fork` with `lastTurnId`). That makes the branching Tree cheap to back with provider sessions, and feeds directly into the provider-integration and Tree-storage tickets.
4. **Custom system prompts:** app-server's `thread/start`/`thread/fork` accept `baseInstructions` and `developerInstructions`. The Agent SDK has `systemPrompt` options (**unverified** in this pass whether a subscription login restricts them).
5. **Library churn:** TanStack AI moved from 0.1 to 0.61 in nine months; the shadcn helpers already pin an outdated range; the community AI SDK providers pin specific Agent SDK versions.

## Unverified

- Whether the SDK-spawned `claude` uses a claude.ai subscription login without an API key (inferred from `apiKeySource: 'none'` and T3's behaviour, not tested).
- OpenAI's terms on third-party apps using ChatGPT login via app-server (no prohibition found).
- Why TanStack's `ai-claude-code` docs on `main` differ from the published 0.6.12.
- Runtime behaviour of the TanStack harness adapters (read, not run).
- Exact shadcn CLI install-time rewriting and component release dates.

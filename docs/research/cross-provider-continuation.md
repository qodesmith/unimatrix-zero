# Continuing a Thread with a different provider or model

Research for [#7](https://github.com/qodesmith/unimatrix-zero/issues/7), part of the map [#1](https://github.com/qodesmith/unimatrix-zero/issues/1). Researched 2026-09-27.

**Question:** How can a Thread started with one provider (or model) be continued with another in the same Tree, and what does it cost?

**Sources checked:**

- Claude Agent SDK `@anthropic-ai/claude-agent-sdk@0.3.283` (`sdk.d.ts`)
- Codex `openai/codex` at `main@41f9084` (Rust app-server protocol and core), plus `codex-cli 0.157.1`, used for a live test
- T3 Code at `main@de251fc2`, plus its unmerged orchestration V2 branch at `0dcb029d`
- Anthropic and OpenAI platform docs
- LibreChat `@3c72c3f`, Open WebUI `@8bd8b4f`, LobeChat `@c0ad257a`, and the TypingMind docs

Claims that could not be verified are marked **(unverified)**.

## Short answer

- **Both SDKs can take a foreign Thread as real conversation history, not just as a pasted wall of text.** I tested both on 2026-09-27 on the author's subscriptions:
  - **Codex:** a documented app-server method, `thread/inject_items`.
  - **Claude:** a crafted transcript fed through the SDK's `sessionStore` resume path. That format is CLI-internal and not a public contract.
- **Only the visible conversation carries over.** That means Prompts, Reply text and images. Thinking and reasoning never cross providers: both are encrypted and tied to the provider, and even across Claude models they are only partly readable. Tool calls should be flattened to text.
- **Cost is roughly the cost of resuming a Thread whose prompt cache has gone cold.** The first Turn after a switch sends the whole Thread as uncached input. This already happens whenever the user returns to a Branch after the cache has expired (5 minutes or 1 hour on Claude; 30 minutes by default on current OpenAI models). So it is a known, bounded cost, not a new category of cost.
- **Switching models within a provider keeps the session.** Claude uses `setModel`, or resumes with a new `model`. Codex takes a per-turn `model` on `turn/start`. Neither needs a replay, but the prompt cache is effectively cold for the new model.
- **T3 Code locks the provider on `main` for technical reasons, not product ones.** History lives in the provider's own session store, and it had no way to hand it across. Its open V2 rewrite (PR #2829) adds exactly this feature as a "budgeted transcript handoff", and on Codex it uses `thread/inject_items`.

## 1. Mechanics: seeding a new session with a prior Thread

### Codex: `thread/inject_items` (native, tested)

- **The method.** The app-server exposes `thread/inject_items`: "Append raw Responses API items to the thread history without starting a user turn" (`codex-rs/app-server-protocol/src/protocol/common.rs:863-868`).
- **Params.** `{ threadId, items: JsonValue[] }`: "Raw Responses API items to append to the thread's model-visible history" (`protocol/v2/thread.rs:1691-1695`).
- **Stability.** Unlike many neighbouring fields, it carries no `#[experimental]` marker.
- **Implementation.** It parses each item as a `ResponseItem`, validates image URLs, and calls `thread.inject_response_items` (`app-server/src/request_processors/turn_processor.rs:973-1003`).
- **Live test.** I ran `thread/start` with `ephemeral: true`, then `thread/inject_items` with two items:
  - a user `message` with `input_text`
  - an assistant `message` with `output_text` that said the user's cat is "Zorblax" and that the user likes teal

  I then ran `turn/start` with "What is my cat called, and what colour did you say I like?" `gpt-5.6-sol` answered "Your cat is Zorblax, and I said you like teal." The injected Reply was treated as the model's own. Usage: `inputTokens 14434` (of which `cachedInputTokens 11136`, the shared Codex system prefix), `outputTokens 59`.
- **Other routes, neither suitable:**
  - `thread/resume` accepts `history: ResponseItem[]`, but it is marked "[UNSTABLE] FOR CODEX CLOUD - DO NOT USE".
  - `path`, which resumes from a rollout file, is also `[UNSTABLE]` (`thread.rs:340-376`).
  - Hand-crafting a rollout JSONL is possible but has no advantage over `inject_items`.

### Claude: crafted transcript via `sessionStore` (works, but on a private format)

- **No public injection API.**
  - `query({ prompt })` accepts only `string | AsyncIterable<SDKUserMessage>`, which is user messages only (`sdk.d.ts:3237-3238`, `6149-6156`).
  - `resume` loads an existing session by ID, and `forkSession` and `resumeSessionAt` branch an existing one (`sdk.d.ts:1703-1706`, `2082-2098`). None of these accept foreign history.
- **The workaround: a custom `SessionStore`.** An `Options.sessionStore` can supply the transcript: `load(key)` is "Called once, in the SDK parent, before subprocess spawn. The result is materialized to a temporary JSONL file; the subprocess resumes from that file using its existing resume code" (`sdk.d.ts:6450-6490`).
  - Returning crafted entries for an unused session UUID and passing `resume: thatUuid` seeds a session.
  - Writing the JSONL into `~/.claude/projects/<cwd>/` would also work (unverified; not tested).
- **Risk.** The entry format is explicitly private: "That union is CLI-internal and not part of the SDK API surface" (`SessionStoreEntry`, `sdk.d.ts:6530-6548`). `sessionStore` is also marked `@alpha`. Any CLI update can break a crafted transcript.
- **Live test (Haiku 4.5).** I supplied two entries:
  - a `user` entry with `message: {role, content}`
  - an `assistant` entry with a text-only Anthropic message and a fake `model: "gpt-5.5"`

  Both were chained by `uuid` and `parentUuid`. The resume worked. The model recalled "Zorblax" and treated the imported Reply as its own words ("I mistakenly said teal was your favorite color").

  Usage on that first Turn was `cache_creation_input_tokens 36022` (1-hour TTL), `input_tokens 10`, `output_tokens 247`. Nearly all of those 36k are Claude Code's own system prompt and tool definitions, which every cold first Turn pays.
- **Foreign Replies need framing.** The model owns imported Replies. It will apologise for another model's mistakes, or defend them. The imported text should be framed, for example with a short prefix or a system note saying "Replies before this point were written by GPT-5.6". Otherwise a user who switched because the first model was wrong gets a confused model.
- **T3 Code hit a related failure.** Claude rejected a session that another Anthropic-compatible backend had produced: "some mismatches in how the api responses were constructed iirc which anthropic then declined" ([t3code#2365 comment](https://github.com/pingdotgg/t3code/issues/2365#issuecomment-4634273729)). Crafted entries should therefore carry text and images only, never foreign thinking blocks or foreign tool IDs.

### Fallback on both providers: text replay

Render the Thread as a transcript and deliver it as supported input. Options:

- the first Prompt
- Claude's `systemPrompt` or `appendSystemPrompt`
- Codex's `developer_instructions` on `thread/start` (`thread.rs:62-110`)
- Codex's experimental `turn/start.additionalContext` (`turn.rs:195-198`)

This uses only public, stable surfaces, so it is the safest option. It is also the worst for fidelity: the whole history becomes one user or system message, and the model loses the turn structure.

## 2. Fidelity: what carries over

| Part of a Reply or Prompt | Across providers | Across Claude models | Across Codex models |
| --- | --- | --- | --- |
| Prompt and Reply text | Yes | Yes (same session) | Yes (same thread) |
| Images and attachments | Yes, if re-sent from the app's own copy (Codex `input_image` data URLs are validated; Claude takes image or document blocks in user content) | Yes | Yes |
| Thinking / reasoning | **Lost.** Claude thinking carries a `signature` that "the API uses ... to verify that thinking blocks were generated by Claude" ([thinking docs](https://platform.claude.com/docs/en/build-with-claude/thinking#thinking-encryption)). OpenAI reasoning is `encrypted_content` (`codex-rs/protocol/src/models.rs`). Neither can be forged. | **Partly.** "A thinking block is readable only by the model that produced it and certain other models, and the API ignores or drops the blocks the target model can't read." For example, Opus 5.5 → Fable 5.1 keeps it; Fable 5.1 → Opus 5.5 drops it ([thinking docs, switching models](https://platform.claude.com/docs/en/build-with-claude/thinking)) | Codex keeps reasoning items in history. Whether another model can decrypt them is **unverified** |
| Tool calls and results (web search, file reads, shell) | Flatten to text. Claude needs `tool_use`/`tool_result` pairs with matching IDs. Codex needs `function_call`/`function_call_output` with `call_id`. Synthesizing them is possible but untested and risky. | Kept | Kept |
| Citations, provider metadata, usage, stop reasons | Lost as structure; can be kept as rendered text or links | Kept | Kept |
| Custom system prompt | Must be re-applied on the new provider | Kept. Claude records the system prompt once and reuses it on resume (`systemPromptSnapshot`, `sdk.d.ts:4454`) | Kept (`base_instructions`/`developer_instructions`) |

The other chat apps drop the same things:

- **LibreChat** drops Anthropic thinking by default (`@librechat/agents` `src/messages/format.ts:1615-1640`).
- **Open WebUI** replays `reasoning_details` "only for output produced by the same model" (`backend/open_webui/utils/middleware.py:2516-2521`).
- **LobeChat** strips signed thinking unless the source was Claude ("Signatures from other providers ... must not be forwarded", `packages/model-runtime/src/providers/anthropic/claudeThinkingHistory.ts:44-89`). It also scopes OpenAI and Gemini opaque reasoning to an exact provider and model fingerprint (`utils/signatureScope.ts:55-115`).

## 3. Cost

- **Claude API list prices, for scale.**
  - Cache writes cost 1.25x base input (5-minute TTL) or 2x (1-hour TTL). Cache reads cost 0.1x, or 0.05x on Opus 5.5 ([prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
  - Cache lifetime is 5 minutes by default, measured from the start of the request.
  - The Agent SDK session in the test wrote with a **1-hour** TTL (`ephemeral_1h_input_tokens`).
- **Claude subscription.** Anthropic does not publish a token formula for Pro/Max limits. The help centre says "Content in projects is cached and counts less against your limits when reused" and lists "current conversation length" as a factor ([usage limit best practices](https://support.claude.com/en/articles/9797557-usage-limit-best-practices)). An open bug reports that re-caching a large, expired context "disproportionately consumes 5-hour & weekly usage limits" ([claude-code#95222](https://github.com/anthropics/claude-code/issues/95222)). The exact subscription weighting is **unverified**.
- **Codex on a ChatGPT plan.** Usage is priced in credits per 1M input, cached-input and output tokens. Cached input is about 10% of uncached, and "Codex credit billing has no separate cache-write charge" ([ChatGPT pricing](https://learn.chatgpt.com/docs/pricing)). OpenAI API caching: reads cost 0.1x; the cache lives 30 minutes by default on GPT-5.6+ ([OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)).
- **First Turn after a provider switch.**
  - The input is the new harness's fixed overhead plus the whole imported Thread. For Claude in the test, that overhead was about 36k tokens. For Codex, about 14k, most of it cached across sessions.
  - All of it is uncached except the provider's shared system prefix. It costs about 10x a warm Turn, for that one Turn only.
  - Later Turns are cached normally.
- **Per-model caching is inferred.** Neither vendor's docs say it outright: a KV cache is computed by one model's weights, so a model switch should be a cache miss. Anthropic's docs do list thinking-config, effort and dropped-thinking changes as cache-invalidating ([what invalidates the cache](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)).
- **This cost already exists in a Tree app.** Returning to any idle Branch after the TTL costs the same full re-cache. Claude's `SessionStart` hook even reports `prompt_cache_likely_expired` and `estimated_cache_write_usd` on resume (`sdk.d.ts`, `SessionStartHookInput`). The UI can warn with the same machinery: "switching will re-read about N tokens of this Thread."
- **Budgeting and summarizing cut the cost.** T3 Code V2 caps the handoff at 16,000 tokens by default (`T3CODE_CONTEXT_HANDOFF_TOKEN_CAP`) and sends "a budgeted selection, not an agent-written summary" (`docs/user/portable-handoffs.md` on the V2 branch). The cost is fidelity: older Turns are dropped.

## 4. Switching models within one provider

- **Claude:**
  - `Query.setModel(model)` changes the model "for subsequent responses" on a live streaming query (`sdk.d.ts:2893`). The alternative is a new `query` with `resume: sessionId` and a different `model`.
  - Either way the session and its history are kept. No replay is needed.
  - The costs are a likely cache miss (inferred, see above) and thinking blocks the target model can't read being dropped silently (thinking docs).
  - T3 Code does both. It calls `context.query.setModel` (`apps/server/src/provider/Layers/ClaudeAdapter.ts:5152-5160`) and restarts with the same `resume` cursor when model options change (`ProviderCommandReactor.ts:789-807`).
- **Codex:**
  - `turn/start` takes `model`: "Override the model for this turn and subsequent turns" (`turn.rs:225-227`).
  - The thread is kept. Core inserts a `<model_switch>` developer message: "The user was previously using a different model. Please continue the conversation according to the following instructions" (`codex-rs/core/src/context/model_switch_instructions.rs`, `context/world_state/model.rs`).
  - T3 Code passes `model` on every `turn/start` (`CodexSessionRuntime.ts:667`, `2562-2586`).

## 5. Prior art

- **T3 Code `main`: provider locked per thread.**
  - **Web lock.** `deriveLockedProvider` says "a started thread must not silently fall back to a different driver" (`apps/web/src/components/ChatView.logic.ts:1014-1040`).
  - **Server lock.** It refuses with "Thread '…' is bound to driver '…' and cannot switch to '…'" (`apps/server/src/orchestration/Layers/ProviderCommandReactor.ts:684-706`).
  - **Why.** History lives only in the provider's native session: a Claude session UUID or a Codex thread ID. Model switches within a provider are allowed because both drivers declare `sessionModelSwitch: "in-session"`.
- **T3 Code history.**
  - A handoff-by-compaction PR ([#1911](https://github.com/pingdotgg/t3code/pull/1911)) was closed unmerged.
  - A feature request for transcript handoff ([#3797](https://github.com/pingdotgg/t3code/issues/3797)) was closed as done "via #2829".
  - That rewrite, [#2829](https://github.com/pingdotgg/t3code/pull/2829), is **still open**. On its branch:
    - `ProviderSessionTransitionPolicy` picks one of `reuse | switch_model_in_session | restart_and_resume | create_with_handoff | reject`.
    - A merged sub-PR (#12352) injects budgeted history into Codex via `thread/inject_items` and gives other adapters "attributed context".
    - Users asked for it to plan on a strong model and implement on a cheap one, and to keep going when one provider's quota runs out.
  - I read the linked discussions only through the PR body **(unverified)**.
- **LibreChat, Open WebUI, LobeChat.**
  - All allow switching provider mid-conversation, with LibreChat's `modularChat` on by default.
  - All do it by **replaying their own stored history** every Turn, converted to the target API.
  - That is easy for them because they are stateless API-key clients.
  - All drop or scope-check provider-bound reasoning, as described in section 2.
  - None warns about cache loss.
- **TypingMind.** Keeps a separate thread per model in multi-model mode, and follow-ups use "the context of your selected (preferred) response" ([docs](https://docs.typingmind.com/manage-and-connect-ai-models/activate-multi-model-responses)). How it converts history for a single-model switch is **undocumented**.

## 6. Options and their consequences for the user

| Option | Fidelity | Cost on the first Turn after the switch | Consequences |
| --- | --- | --- | --- |
| **A. No cross-provider continuation** (T3 Code `main`). The provider is fixed per Tree, or per Branch from its root. | n/a | none | Simplest. The user must start over to try the other AI, which undercuts a branching app whose appeal is "try this Thread elsewhere". Model switches within a provider remain free. |
| **B. Native injection of the full Thread** (Codex `inject_items`; Claude crafted `sessionStore` transcript) | High for the visible conversation: text and images, with Turn structure kept. Thinking lost; tools flattened to text. | Whole Thread uncached, about 10x a warm Turn, once | Feels seamless. Claude's side rests on a private, `@alpha` format, so it needs a canary test per CLI update and a fallback to C. Imported Replies must be attributed or the new model owns another model's mistakes. |
| **C. Text replay** (transcript in the first Prompt or system prompt) | Medium: the same content, but flattened into one message, so turn roles blur | Same as B | Uses only stable APIs, so it is the robust fallback. The model may treat history as a quoted document rather than its own conversation. It needs clear delimiters, and prompt-injection text inside old Replies gets more weight. |
| **D. Budgeted selection** (T3 Code V2: last N tokens, default 16k) | Lower: old Turns dropped | Capped | Predictable cost on the $20 plans. The user may be surprised that the new AI "forgot" early Turns. The UI must say what was carried over. |
| **E. Summary handoff** (compact, then send the summary; T3 Code #1911) | Lowest: paraphrased | Small, plus one summarization call on the old provider | Cheapest for long Threads. It costs usage on the provider being left, which may be the one out of quota. Detail loss is invisible to the user. |

Within one provider, a model switch needs none of the options above. The session is kept, and the only costs are a cold cache and possibly dropped thinking.

## Implications for other tickets (for the map owner)

- **Tree storage must keep a provider-neutral copy of every Prompt and Reply** (text, attachment files, rendered tool summaries). Without it, B to E are impossible, because the provider's own session files are not portable.
- **A Thread can span several provider sessions.** Each Reply needs a binding of the form (provider, session or thread ID, message UUID) so a Fork can `resumeSessionAt` / `forkSession` natively when it stays on the same provider, and fall back to injection when it doesn't. This bears on the provider driver/instance architecture item.
- **The same injection machinery covers the cases where native forking fails.** Examples: a Claude session file was cleaned up (`cleanupPeriodDays`), or a Codex rollout is missing. Cross-provider continuation and "rehydrate a Branch" may be one feature.
- **The usage and rate-limit display ticket can reuse the cold-cache warning.** One piece of UI serves both cases, "switching or resuming will re-read about N tokens".

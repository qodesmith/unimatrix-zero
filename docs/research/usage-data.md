# What usage data each Provider reports

Research for [#35](https://github.com/qodesmith/unimatrix-zero/issues/35), part of the map [#1](https://github.com/qodesmith/unimatrix-zero/issues/1). Researched 2026-10-09. Builds on [#2](https://github.com/qodesmith/unimatrix-zero/issues/2) (`docs/research/subscription-session-capabilities.md` on `research/subscription-session-capabilities`) and [#4](https://github.com/qodesmith/unimatrix-zero/issues/4) (`docs/research/hidden-sign-in.md` on `research/hidden-sign-in`), which found the event streams; this note answers what is in them, when they arrive, and what a limit looks like.

**Question:** what usage and rate-limit data does each Provider report on subscription auth, and when? Can it be read on demand or only after a Turn? Does it give reset times and percent used? What does hitting a limit look like mid-Reply?

## Sources and method

| Thing | Version |
| --- | --- |
| `@anthropic-ai/claude-agent-sdk` | 0.3.296 (bundles Claude Code 2.1.296) |
| `@openai/codex` (npm, app-managed style) | 0.162.1 |
| openai/codex repo | `0c22ce8` (2026-10-09) |

- **[sdk.d.ts]**: the Agent SDK type definitions. **[cc]**: strings in the bundled `claude` binary (minified JS). **[codex src]**: Rust source paths in openai/codex.
- Vendor pages: [Use the Claude Agent SDK with your Claude plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) and [Codex pricing](https://learn.chatgpt.com/docs/pricing), both fetched 2026-10-09.

**Live tests (Claude, verified live on the user's Max account).** The SDK ran with `CLAUDE_CONFIG_DIR` set to a fresh temp folder holding a copy of the Keychain credentials with the refresh token removed (so nothing could rotate the user's login), `settingSources: []`, `tools: []`, Haiku, `persistSession: false`. Total usage: five tiny Turns. `~/.claude` was not touched. To see the wire, `ANTHROPIC_BASE_URL` pointed at a local pass-through proxy that logged response headers; to see a limit without spending one, the same proxy **fabricated** a 429 with the server's rate-limit headers, or cut a real stream mid-Reply. Those runs are marked **(simulated)**: the CLI's handling is real, the server response is not.

**Codex: no live call this time.** The only ChatGPT credentials are in `~/.codex/auth.json`, and its access token has expired. Codex refresh tokens are single-use (`refresh_token_reused` → "your refresh token was already used", [codex src] `login/src/auth/manager.rs:1687-1703`), so letting a copied `auth.json` refresh would sign the user's own Codex out. Instead, `codex app-server` 0.162.1 ran with a temp `CODEX_HOME`, a **fake** `auth.json`, and `openai_base_url`/`chatgpt_base_url` pointed at a local fake chatgpt.com backend over HTTPS (trusted through `CODEX_CA_CERTIFICATE`). That shows exactly how the real binary maps backend responses to app-server messages **(simulated)**. Plan-level facts for real accounts come from #2's live run and the user's own Codex session logs (read only).

---

## TL;DR

| | Claude (Agent SDK) | ChatGPT (Codex app-server) |
| --- | --- | --- |
| Windows | 5-hour (`five_hour`) and 7-day (`seven_day`) on Max, plus per-model weekly rows (for example Fable) and extra-usage spend (verified live) | Whatever the backend sends as `primary`/`secondary`, each with its own `windowDurationMins`. Plus showed **weekly only**, in the `primary` slot (#2, live). Pro: OpenAI says "Pro plans currently have no five-hour limit" |
| Percent used | Yes. Event: fraction 0-1. `get_usage`: 0-100 | Yes, `usedPercent` integer 0-100 |
| Reset time | Yes. Event: Unix seconds. `get_usage`: ISO string | Yes, `resetsAt` Unix seconds |
| On demand (no Turn) | Yes, via the **experimental** `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`; needs a running query, ~180 ms, no tokens (verified live) | Yes, `account/rateLimits/read`; fetches `/wham/usage` each call (verified #2 live; simulated here) |
| Pushed during a Turn | `rate_limit_event` once per Turn, as the response headers arrive (verified live) | `account/rateLimits/updated`, from response headers and `codex.rate_limits` stream events (simulated; #2 live) |
| Limit hit | `rate_limit_event` with `status: "rejected"`, then a synthetic assistant message (`error: "rate_limit"`, text "You've hit your session limit · resets 6:20pm (America/New_York)"), then a `result` with `is_error: true`, `api_error_status: 429`. No retry (simulated) | `error` notification with `codexErrorInfo: "usageLimitExceeded"`, `willRetry: false`, a ready-made message with the reset time, then `turn/completed` with `status: "failed"`. No retry (simulated) |
| `seven_day_oauth_apps` | Undocumented; `null` on this Max account; the CLI never names it to the user. No evidence it applies to us | n/a |

---

## Claude (Agent SDK)

### Three sources of usage data

1. **`rate_limit_event`** in the message stream (`SDKRateLimitEvent`, [sdk.d.ts]: "Rate limit event emitted when rate limit info changes"). Typed fields: `status` (`allowed` | `allowed_warning` | `rejected`), `resetsAt`, `rateLimitType` (`five_hour` | `seven_day` | `seven_day_opus` | `seven_day_sonnet` | `seven_day_overage_included` | `overage`), `utilization`, `surpassedThreshold`, and overage fields (`overageStatus`, `overageResetsAt`, `overageDisabledReason`, `isUsingOverage`, ...). **Verified live**, a real Turn on Max:

   ```json
   {"status":"allowed","resetsAt":1791594600,"rateLimitType":"five_hour",
    "overageStatus":"rejected","overageDisabledReason":"org_level_disabled","isUsingOverage":false,
    "unifiedWindows":{"five_hour":{"utilization":0.04,"resetsAt":1791594600},
                      "seven_day":{"utilization":0.02,"resetsAt":1792119600}}}
   ```

   - `unifiedWindows` is present at runtime but **not in the types**. It's the only place the event carries both windows; the typed fields describe just the "representative" window.
   - Utilization is a **fraction 0-1**; `resetsAt` is **Unix seconds**.
   - It's built from the API's response headers (proxy log, verified live): `anthropic-ratelimit-unified-status`, `-representative-claim`, `-reset`, `-5h-utilization`, `-5h-reset`, `-5h-status`, `-7d-utilization`, `-7d-reset`, `-7d-status`, `-overage-status`, `-overage-disabled-reason`, `-fallback-percentage`. No header mentions OAuth apps.
   - **When:** once per Turn, when the first response's headers arrive. In the runs it came before or right after the first assistant message. A Turn that makes several API calls (tools, Subagents) gets new headers on each call; the CLI emits again when the info changes ([sdk.d.ts]).

2. **`get_usage`**: `query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true })`. [sdk.d.ts]: "EXPERIMENTAL: this API is unstable and may change or be removed in any release without notice". It reads the claude.ai usage endpoint (`/api/oauth/usage`, [cc]). **Verified live, before any Turn** (the query's input was held back, so no tokens were spent), 176 ms:
   - `subscription_type: "max"`, `rate_limits_available: true`.
   - `five_hour: {utilization: 5, resets_at: "2026-10-10T01:09:59Z"}`, `seven_day: {utilization: 2, resets_at: "2026-10-16T02:59:59Z"}`: **percent 0-100, ISO strings**.
   - `limits[]`, the richest form: `{kind: "session" | "weekly_all" | "weekly_scoped", group, percent, severity: "normal", resets_at, scope: {model: {display_name: "Fable"}}, is_active}`.
   - `model_scoped: [{display_name: "Fable", utilization: 0, resets_at}]`, `extra_usage` and `spend` (usage credits; disabled here), `seven_day_breakdown` (Claude Code 99%, Chats 1%, Cowork 0%).
   - About 15 more top-level keys with code names, all `null` (`seven_day_cowork`, `tangelo`, `iguana_necktie`, `cedar_ember`, ...). Treat them as noise.
   - `rate_limits_available` is "False when plan rate limits do not apply (API key, Bedrock, Vertex, or missing profile scope)" [sdk.d.ts].
   - Called after a `result` in single-prompt mode it failed with "Query closed before response received": call it while the query is open.

3. **The `result` message**: `usage`, `modelUsage` (per Model) and `total_cost_usd`. Tokens, not plan usage; the cost is an API-price estimate (`costBasis: "list"`), not what the subscriber pays. `accountInfo()` gives the email and "Claude Max".

**On demand, without a Turn:** only through the experimental `get_usage`, and only on a live query (a spawned `claude` process). A Provider session the app keeps open anyway can answer it. Otherwise, start a query with an input stream that never yields, call it, and close (verified live). `rate_limit_event` comes only with Turns.

### `seven_day_oauth_apps`

- Typed in `get_usage` as one more `{utilization, resets_at}` window [sdk.d.ts]. **`null` on this Max account** (verified live). No API header carries it.
- In the CLI it's one of the claim types the server can name as the cause of a limit (`five_hour`, `seven_day`, `seven_day_overage_included`, `seven_day_opus`, `seven_day_sonnet`, `seven_day_cowork`, `seven_day_omelette`, `seven_day_oauth_apps`). The CLI turns the first five into words ("session limit", "weekly limit", ...) and **deliberately gives no label** to the last three [cc]. It's absent from the typed `rateLimitType` union in `rate_limit_event`.
- Anthropic documents nothing about it. Community tools that read `/api/oauth/usage` show it as `null` too ([ccusage](https://pypi.org/project/ccusage/), [ClaudeUsage](https://github.com/backmind/ClaudeUsage)).
- Our traffic goes through Claude Code's own sign-in, and the 7-day breakdown files it under "Claude Code". So if this bucket exists for apps with their own claude.ai OAuth client, it doesn't look like it applies to us. **Inference, not verified.** Read it if it's ever non-null; don't build around it.
- Context from Anthropic's support page (updated 2026-10-07): "You can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits." Max and Team plans also now include monthly API credits that cover the Agent SDK, but those need an API key from a Console organization, which this app doesn't use. A June 2026 plan to move Agent SDK usage onto a separate monthly credit was paused ("For now, nothing has changed"). Nothing mentions a separate OAuth-app limit.

### Hitting a limit (simulated)

The proxy answered with a 429 and `anthropic-ratelimit-unified-status: rejected`, representative claim `five_hour`. The SDK emitted, in order:

1. `rate_limit_event` with `status: "rejected"`, `rateLimitType: "five_hour"`, `resetsAt`, `unifiedWindows` (5h at 1.0).
2. A synthetic assistant message: `model: "<synthetic>"`, `error: "rate_limit"`, `api_error: "usage_limit_reached"`, `is_api_error_message: true`, text **"You've hit your session limit · resets 6:20pm (America/New_York)"**, plus `api_error_params.rate_limit_info`.
3. `result` with `is_error: true`, `terminal_reason: "api_error"`, `api_error_status: 429`, `api_error: "usage_limit_reached"`, `result` = the same sentence. Note: `subtype` is still `"success"`, so check `is_error`, not `subtype`.

There was no retry (the CLI made no further request). `SDKAssistantMessageError` [sdk.d.ts] separates `rate_limit` from `overloaded`, `billing_error` and the others. The weekly case reads "weekly limit" [cc]. If usage credits are on, `overageStatus: "allowed"` / `isUsingOverage: true` means the Turn continues on credits instead.

**Mid-Reply.** Limits are checked when each API request starts. A single long reply isn't cut off partway (inferred: the headers come before the body, and no stream error type carries a usage limit). A Reply that makes several API calls (tool use, Subagents) can be rejected on a later call. Simulated by cutting a real stream and then rejecting the next request:

- `stream_event` deltas for the partial text arrived, then `message_stop`.
- **No assistant message was emitted for the partial text**; the transcript doesn't keep it.
- Then `rate_limit_event` `rejected`, the synthetic error message, and the error `result`.

So the app must keep the partial text it showed, the same rule as Stop ([#23](https://github.com/qodesmith/unimatrix-zero/issues/23)), and mark the Reply "limit reached, resets X".

**Side finding (simulated):** when a stream breaks for a reason other than a limit, the CLI quietly re-sends the request without streaming. The app sees deltas for the partial text, a `message_stop`, then about a second later a **complete assistant message that starts again from the beginning**. The streaming Reply must be replaced by the final assistant message, not appended to.

---

## ChatGPT (Codex app-server)

### Shapes ([codex src] `app-server-protocol/src/protocol/v2/account.rs`)

- `account/rateLimits/read` → `{ordinaryUsageAllowed, rateLimits: RateLimitSnapshot, rateLimitsByLimitId, rateLimitResetCredits, accountId, rateLimitUpsell}`.
- `RateLimitSnapshot` = `{limitId, limitName, primary, secondary, credits, individualLimit, spendControlReached, planType, rateLimitReachedType}`.
- `RateLimitWindow` = `{usedPercent: integer 0-100, windowDurationMins, resetsAt: Unix seconds}`.
- `ordinaryUsageAllowed`: "Null means unavailable; clients must not infer recovery from percentages or reset times."
- `rateLimitsByLimitId` can hold more than one bucket (for example a model-specific limit with its own `limitName`). The snapshot comes from `/wham/usage` (`limit_window_seconds` ÷ 60 becomes `windowDurationMins`).

**`primary` and `secondary` aren't "5-hour" and "weekly".** They are whatever windows the backend sends. Codex's own TUI labels each one from its `windowDurationMins` (≈300 → "5h", ≈1440 → "daily", ≈10080 → "weekly", ≈43200 → "monthly"), falling back to a generic label (`tui/src/chatwidget/rate_limits.rs:103-140`). Do the same.

### Which windows each plan reports

- **Plus: one weekly window, in `primary`; `secondary: null`.** #2 saw this live on 2026-09-27, and the user's own Codex session logs from that day record the same (`primary.window_minutes: 10080`, `secondary: null`, `plan_type: "plus"`).
- **Pro:** OpenAI's pricing page: "Pro plans currently have no five-hour limit." So expect weekly only there too.
- **Plus and Standard Business:** the page still gives "local messages per five-hour period" estimates and says "Weekly limits may also apply", which contradicts what Plus actually reported. The backend decides; the client just shows what comes.
- **Enterprise/Edu with flexible pricing:** "no fixed rate limits" (credits instead).
- Free and Go have no published figures.
- **Not verified live** for any plan other than Plus. The app has to handle 0, 1 or 2 windows of any length.

### When

- **On demand:** `account/rateLimits/read` works with no Thread and no Turn. Each call fetches `/wham/usage` (simulated: the fake backend saw one request per read; live in #2).
- **During a Turn:** `account/rateLimits/updated` arrives when a response starts, built from `x-codex-primary-used-percent` / `-window-minutes` / `-reset-at` (and `secondary`) headers, and from `codex.rate_limits` stream events ([codex src] `codex-api/src/rate_limits.rs`). The pushed snapshot has `credits: null` and `planType: null` (simulated); per its docs, nullable account fields in an update don't clear earlier values, so merge it into the last full read.
- Token counts per Thread: `thread/tokenUsage/updated` (includes `modelContextWindow`).

### Hitting a limit (simulated)

The fake backend answered `/responses` with a 429 `{"error": {"type": "usage_limit_reached", "plan_type": "plus", "resets_at": ..., "limit_window_minutes": 300}}`. The app-server sent:

1. `account/rateLimits/updated` with `primary.usedPercent: 100`.
2. `thread/status/changed` → `systemError`.
3. `error` with `{message: "You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at 6:26 PM.", codexErrorInfo: "usageLimitExceeded", willRetry: false}`.
4. `turn/completed` with `status: "failed"` and the same error.

There was no retry. The message text depends on the plan (`protocol/src/error.rs:701-800`): Plus says upgrade/buy credits, Pro says buy credits, Free/Go say upgrade to Plus, workspace plans say ask your admin or out of credits. The client gets `codexErrorInfo` and the reset time inside the text. The structured reset time is better read from `account/rateLimits/read`.

**Mid-Reply.** OpenAI: "If you reach your usage limits during an active turn, the agent will be able to continue working on that turn" (subject to fair use). In source, the usage-limit error comes only from an HTTP 429 at request start. A `response.failed` partway through a stream has no usage-limit code ([codex src] `codex-api/src/sse/responses_error.rs`). So a Reply already running normally finishes, and the limit shows on the next Prompt. If a later request inside the Turn were refused, the items completed before it stay in the Turn and the Turn ends `failed` (inferred from source, not observed).

---

## What this means for the app

1. **One small, Provider-neutral usage model:** a list of windows `{label from duration, percent 0-100, resetsAt}` per Provider, plus a "limited until X" state. Normalize Claude's fraction/ISO/Unix mix. Show only the windows a Provider reports (0, 1 or 2+, including Claude's per-model weeklies such as Fable).
2. **Refresh:** read on demand when the app opens, when a Provider connects, and on a timer; let in-Turn pushes update it between reads. Claude's on-demand read is experimental, so keep a fallback that shows the last `rate_limit_event` (with `unifiedWindows`) when `get_usage` is gone.
3. **Limit reached:** detect it by `error === "rate_limit"` / `api_error_status === 429` (Claude) or `codexErrorInfo === "usageLimitExceeded"` (Codex). Never retry automatically. Mark the Reply with the vendor's sentence or our own "resets at X", and keep any partial text we showed.
4. **Concurrent Threads** share one account-wide limit on both Providers (Codex's `account/rateLimits/updated` is account-wide, per #31), so one Thread hitting the limit means every Thread on that Provider is limited.
5. **Claude stream replacement:** on a non-streaming fallback, swap the streamed text for the final assistant message.

## Open

- A real limit on either Provider was never hit; the error shapes come from real CLI/app-server code given fabricated server answers.
- Codex windows for Pro, Business, Free and Go weren't seen live; Plus is from 2026-09-27.
- What `seven_day_oauth_apps` counts.
- Whether Claude's `get_usage` keeps its shape (it's explicitly unstable), and how often the usage endpoint can be polled before it throttles.

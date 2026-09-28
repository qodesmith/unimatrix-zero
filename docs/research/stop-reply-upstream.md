# What stopping a Reply does upstream

Research for GitHub issue #23. Researched 2026-09-28 against `@anthropic-ai/claude-agent-sdk@0.3.283` (bundled native `claude` binary, darwin-arm64) and `openai/codex` at commit `44fe510ce3ee61c8ef623adcbf89b901c73ddd61` (main, 2026-09-28).

Labels: **Documented** (public doc, URL cited), **Source** (code read, path cited), **Inference** (our reasoning, not confirmed by a provider), **Observed** (seen in local data on this machine).

## Summary

On both providers, stopping a Reply is a client-side cancellation: the local agent (Claude Code under the Agent SDK, or codex-rs under `codex app-server`) aborts its in-flight streaming request, which closes the HTTP/WebSocket stream, and then writes an "interrupted" marker into the session history. Neither client sends a provider-level "cancel generation" call for a user stop. Whether the model servers stop generating the moment the connection drops, and whether any tokens past the last streamed one count toward the 5-hour and weekly subscription windows, is **not publicly documented by either Anthropic or OpenAI**. The safe assumption is that input tokens and all output streamed so far count, and that a small unobservable tail may count too. For session state, completed parts of the stopped Reply are kept: finished text blocks and tool calls, plus cancelled/aborted tool results. The content block that was still streaming is **not** kept. The next Prompt continues from the kept history plus an interruption marker, and the session can be resumed or forked normally. Claude Code's Esc and Codex TUI's Esc go through the same interrupt path an SDK or app-server client uses.

## Claude (Agent SDK on a subscription)

- **`Query.interrupt()`**: in streaming-input mode this sends a `control_request` with `subtype: "interrupt"` to the Claude Code child process. The session and process stay alive. The resolved receipt lists queued Prompts that will still run (`still_queued`), or cancelled ones when `cancel_queued: true` is set. **Source**: `sdk.d.ts` lines ~2840-2857 and `SDKControlInterruptResponse` (~4559); `sdk.mjs` (`subtype:"interrupt"`).
- The interrupted turn still ends with a `ResultMessage`. Its `terminal_reason` is `"aborted_streaming"` if the stop landed during model output, or `"aborted_tools"` if it landed during tool execution. Messages already produced stay in the stream and must be drained. **Documented**: https://code.claude.com/docs/en/agent-sdk/python (interrupt section). **Source**: `TerminalReason` in `sdk.d.ts` (~9579).
- Inside the CLI, the abort path drains any remaining tool results, emits a synthetic user message `[Request interrupted by user]`, and returns `{reason:"aborted_streaming"}`. Unfinished `tool_use` blocks get `cancelled` tool results plus `[Request interrupted by user for tool use]`. **Source**: minified bundle strings in `claude-agent-sdk-darwin-arm64/claude` (function building `content:[{type:"text",text:e?pu:RE}]` with `interruptedMessageId`; the abort branch ending `return ...{reason:"aborted_streaming"}`).
- The HTTP request is cancelled through an `AbortController` wired to the bundled Anthropic TypeScript client. The bundle contains that client's `APIUserAbortError` ("Request was aborted."). **Source**: bundle strings. That this closes the SSE connection, rather than letting the Reply finish and go unread, is **Inference** from standard fetch-abort semantics.
- **`Options.abortController`**: this cancels the whole query, not just the turn. The SDK closes stdin, gives the child a grace window of about 2 s (`GRACEFUL_EXIT_TIMEOUT_MS`), then kills it. Use `interrupt()` for "stop this Reply" and `abortController` for "tear down the session process". **Source**: `sdk.d.ts` ~1520 and ~9395-9416. The docs describe it only as "Controller for cancelling operations" (**Documented**: https://code.claude.com/docs/en/agent-sdk/typescript).
- **Server side**: Anthropic docs describe streaming and client-side recovery of interrupted streams, but say nothing about whether closing the connection halts generation. **Documented (absence)**: https://platform.claude.com/docs/en/build-with-claude/streaming. **Cannot be established.**

## ChatGPT (`codex app-server`)

- **`turn/interrupt {threadId, turnId}`**: this submits `Op::Interrupt` to the core session. The JSON-RPC response (`{}`) is deferred until core emits `TurnAborted`, so a successful response means the turn has actually ended. After that the turn reports `status: "interrupted"`. **Source**: `codex-rs/app-server/src/request_processors/turn_processor.rs` (`turn_interrupt_inner`), `app-server-protocol/src/protocol/v2/turn.rs` (`TurnStatus::Interrupted`). **Documented**: https://learn.chatgpt.com/docs/app-server (previously developers.openai.com/codex/app-server).
- **Core**: `handle_task_abort` cancels the task's `CancellationToken`. It waits up to `GRACEFULL_INTERRUPTION_TIMEOUT_MS = 100` ms for the task to finish, then hard-aborts the tokio task, records the interrupted marker, flushes the rollout, and emits `TurnAborted`. **Source**: `codex-rs/core/src/tasks/mod.rs`.
- **Stream cancellation**: the sampling loop awaits `stream.next().or_cancel(&cancellation_token)`. On cancel it breaks with `TurnAborted` and drops the `ResponseStream`. **Source**: `codex-rs/core/src/session/turn.rs` (~2601-2629).
  - WebSocket transport: the sender task sees the consumer dropped and drops the WebSocket connection. **Source**: `codex-rs/codex-api/src/endpoint/responses_websocket.rs` (~310-335).
  - HTTP SSE transport: the reader returns on the next failed `tx_event.send`, which drops the response body. **Source**: `codex-api/src/sse/responses.rs`.
  - codex-rs has a WebSocket `response.interrupt` message (`mode: "discard_partial_items"`), but it is used only for steer/preempt on "responses lite" models, **not** for a user interrupt. **Source**: `responses_websocket.rs` ~694-705; `turn.rs` ~2611-2619.
- **Server side**: OpenAI documents that "to cancel a synchronous response, terminate the connection". That is exactly what codex does, so OpenAI treats connection close as the cancel signal. **Documented**: https://developers.openai.com/api/docs/guides/background. How promptly the server stops, and whether that applies identically to the ChatGPT-subscription Codex backend, is not documented.

## Usage (subscription limits)

- **Claude**: the help centre says usage depends on conversation length and complexity, features, model and effort. It does not address stopped or interrupted responses. **Documented (absence)**: https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work.
- **Codex**: the docs say "Your prompt, files, chat history, tool results, and ChatGPT's response all use tokens" and that the 5-hour and weekly limits apply. They say nothing about cancelled turns. **Documented**: https://learn.chatgpt.com/docs/pricing. The help-centre article https://help.openai.com/en/articles/11369540 returned 403 to automated fetch and was not verified.
- **OpenAI API**: "If the stream is interrupted or cancelled, you may not receive the final usage chunk". That implies usage is still incurred, but it does not say how much. **Documented**: https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events.
- **Codex client accounting**: on interrupt, codex-rs never receives `response.completed` for the in-flight request, so its local token counts omit that request's usage. **Source/Inference**: `turn.rs` (token count comes from `Completed`). Claude's interrupted `ResultMessage` still carries `usage` and `total_cost_usd` (**Documented**: https://code.claude.com/docs/en/agent-sdk/agent-loop#handle-the-result), but how the aborted stream's tokens are counted there is not documented.
- **Bottom line**: whether tokens generated after the stop, or never streamed, count is **not established** for either provider. **Inference**: input (prompt plus history) is always consumed; output up to the stop is consumed; any server-side tail is small but unknowable. Stopping saves output, not input.

## Session state after a stop

- **Claude**: completed content blocks from the stopped Reply stay in the session JSONL. Each finished block is its own `assistant` entry; the SDK emits one `AssistantMessage` per content block (**Documented**: agent-loop page). A `[Request interrupted by user]` user entry follows. The next Prompt is sent with that history, so the model sees its partial work and the interruption. Resume and fork by session ID work as for any session (**Documented**: https://code.claude.com/docs/en/agent-sdk/sessions). The block still streaming at the stop is not persisted. **Inference**: blocks are materialised at `content_block_stop`. **Observed**: in a local transcript, an Esc about 1.4 s into a request left no assistant entry from that request, only the interrupt marker. There is no API to "resume the partial block". To continue it, you send a new Prompt; Anthropic documents a capture-and-continue pattern for broken streams at https://platform.claude.com/docs/en/build-with-claude/streaming.
- **Codex**: history items are recorded only on `response.output_item.done`. `AgentMessageContentDelta` and reasoning deltas are transient and never written to the rollout. **Source**: `turn.rs` (`OutputItemDone` handling), `codex-rs/rollout/src/policy.rs`. After an interrupt, codex-rs keeps:
  - all items completed earlier in the turn;
  - synthesised `"aborted"` outputs for cancelled tool calls (**Source**: `core/tests/suite/abort_tasks.rs::interrupt_tool_records_history_entries`);
  - a model-visible `<turn_aborted>` marker ("The user interrupted the previous turn on purpose...", **Source**: `core/src/context/turn_aborted.rs`). This marker is sent with the next request (**Source**: `abort_tasks.rs::interrupt_persists_turn_aborted_marker_in_next_request`);
  - a persisted `TurnAborted` event.

  The partially streamed message text is dropped. Fork supports `ForkSnapshot::Interrupted`, which forks "as if the source thread had been interrupted now", keeping an interruption marker rather than an unmarked partial turn. **Source**: `core/src/thread_manager.rs`. **Documented**: app-server doc above.

## Latency

- **Codex**: client-side, the sampling loop exits as soon as the token is cancelled. `turn/interrupt` answers once `TurnAborted` is emitted, bounded by about 100 ms of graceful wait plus hook, marker and rollout flush time. Tool processes may take longer, since "unified exec processes may still be running in the background". **Source**: as above.
- **Claude**: `interrupt()` is a stdio control round-trip to a local process followed by an in-process abort, so it is effectively immediate for the Reply stream. **Inference**. Tool execution drains first (`aborted_tools`).
- **Server-side halt latency**: undocumented for both providers.

## CLI Esc

- **Claude Code**: Esc "Interrupt[s] Claude... Stop the current response" (**Documented**: https://code.claude.com/docs/en/interactive-mode). The SDK drives the same CLI binary. Both paths abort the same per-turn controller and write the same `[Request interrupted by user]` marker. The marker schema even notes "the API msg_* id that Esc cancelled", so an SDK `interrupt()` is the headless equivalent of Esc. **Source**: bundle strings; **Inference** for "identical".
- **Codex TUI**: Esc is the default `chat.interrupt_turn` binding. The TUI is itself an app-server client and sends `ClientRequest::TurnInterrupt`, retrying once on a turn-id race. So it is literally the same `turn/interrupt` Unimatrix Zero would call. **Source**: `codex-rs/tui/src/keymap.rs` (~1664), `tui/src/app/thread_routing.rs` (~683-705), `tui/src/app_server_session.rs`.

## Implications for Unimatrix Zero

- Implement Stop as `Query.interrupt()` for Claude and `turn/interrupt` for ChatGPT. Do not use `abortController` or kill the process: that ends the whole Claude session process, costs about 2 s of grace time, and forces a resume.
- Treat Stop as a best-effort saving of output tokens only. Do not promise users that a stopped Reply "costs nothing".
- The provider will not remember the partial text that was mid-stream. If the UI shows the streamed-but-unfinished text, it is display-only unless we deliberately re-inject it into the next Prompt.
- Wait for the terminal signal before accepting the next Prompt on the same session: the Claude `ResultMessage` with `terminal_reason` `aborted_*`, or the `turn/interrupt` response / `turn/completed` with `interrupted`. Codex rejects a mismatched `turnId`.
- A stopped Reply can be resumed or forked like any other. Forking lands after the interruption marker.

## Open questions / cannot be established

- Whether Anthropic or OpenAI servers stop generating immediately on disconnect, or finish internally.
- Whether tokens generated but not delivered count toward Claude 5-hour/weekly limits or Codex 5-hour/weekly limits.
- Whether the ChatGPT-subscription Codex backend (WebSocket transport) handles a dropped connection the same way as the public Responses API.
- Exact Claude Code persistence of a partially streamed content block. This rests on minified source plus one local observation; a controlled test (stop mid-text, inspect JSONL) would confirm it at the cost of a little usage.

## Sources

- https://code.claude.com/docs/en/agent-sdk/python
- https://code.claude.com/docs/en/agent-sdk/typescript
- https://code.claude.com/docs/en/agent-sdk/agent-loop
- https://code.claude.com/docs/en/agent-sdk/sessions
- https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
- https://code.claude.com/docs/en/interactive-mode
- https://platform.claude.com/docs/en/build-with-claude/streaming
- https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work
- https://learn.chatgpt.com/docs/app-server
- https://learn.chatgpt.com/docs/pricing
- https://developers.openai.com/api/docs/guides/background
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events
- npm `@anthropic-ai/claude-agent-sdk@0.3.283`: `sdk.d.ts`, `sdk.mjs`, bundled `claude` binary
- github.com/openai/codex @ `44fe510`: `codex-rs/app-server/src/request_processors/turn_processor.rs`, `codex-rs/app-server-protocol/src/protocol/v2/turn.rs`, `codex-rs/core/src/tasks/mod.rs`, `codex-rs/core/src/session/turn.rs`, `codex-rs/core/src/session/handlers.rs`, `codex-rs/core/src/context/turn_aborted.rs`, `codex-rs/core/src/thread_manager.rs`, `codex-rs/codex-api/src/endpoint/responses_websocket.rs`, `codex-rs/codex-api/src/sse/responses.rs`, `codex-rs/rollout/src/policy.rs`, `codex-rs/core/tests/suite/abort_tasks.rs`, `codex-rs/tui/src/keymap.rs`, `codex-rs/tui/src/app/thread_routing.rs`

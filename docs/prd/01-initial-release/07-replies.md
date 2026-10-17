# 7. Replies

Source: [Canvas mode UX](https://github.com/qodesmith/unimatrix-zero/issues/14), [What stopping a Reply does upstream](https://github.com/qodesmith/unimatrix-zero/issues/23), [Tree storage and source of truth](https://github.com/qodesmith/unimatrix-zero/issues/11), [AI and chat-UI library stack](https://github.com/qodesmith/unimatrix-zero/issues/12), [Provider drivers, process model and IPC event list](https://github.com/qodesmith/unimatrix-zero/issues/38).

- **Streaming.** Replies render word by word on both Providers, through Streamdown with Shiki, math and Mermaid (loaded only when a Reply contains a diagram), behind one `<ReplyMarkdown>` component. Thinking summaries show live, collapsed, and are never stored. Tool calls, approval cards, file chips and Subagent blocks render inline at the point they happened.
- **Stop** (button and Esc) calls Claude `interrupt()` or Codex `turn/interrupt`, never tears the session down, waits for the turn-ended signal, and on Codex also interrupts every running Subagent. The partial text shown is stored by the app, because the Provider drops the half-streamed part. A stopped Reply is tagged and can be continued or branched from.
- **Failure** keeps the text the Reply had written and says why on its own line: connection lost, limit reached (with the reset time), the vendor program crashed, disk full. The app never retries on its own. **Retry** rewinds the Provider session to before the failed Turn and runs the Prompt again; it is off, with the reason, when the app is offline or the Provider is signed out. Replies left streaming after a crash become `interrupted` and behave like stopped ones.
- **Saved as it goes.** The Reply row is written at start, per finished part, about every second for partial text, and at the end (`complete` / `stopped` / `failed`). A Claude stream that breaks and is silently re-sent replaces the streamed text (`TEXT_REPLACE`) rather than appending.
- **Automatic title.** Written once, after the first Reply finishes, by the smallest Model the first Reply's Provider offers on the user's plan, as a tiny tool-free request outside the Tree. Never regenerated; renaming is final.
- **Not stored, display only:** thinking summaries, durations and timings, "files changed" summaries (computed from Snapshots).

## Verify while building

- Streamdown's default plugin list (it must not include `rehype-raw`) and a custom image component for the click-to-load chip ([#39](https://github.com/qodesmith/unimatrix-zero/issues/39)).

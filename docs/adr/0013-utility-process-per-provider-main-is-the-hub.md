# One utility process per Provider; main is the event hub

Each connected Provider's driver runs in its own Electron utility process (a Provider host), started only when that Provider is connected, and every event goes Provider host → main → renderer on the single typed channel, with commands going the other way. The research recommended one utility process for both drivers, streaming straight to windows over `MessagePortMain` and saving through main. We split by Provider because the extra process costs about 30–50 MB and buys isolation: a crash or hang in the Claude SDK never interrupts ChatGPT Replies, and the reverse, matching the per-Provider failure states the UI already needs. We route through main because the database lives there ([ADR 0001](0001-app-owns-the-tree.md)), so the renderer only ever sees events main has saved or will save, in the same order; the extra hop costs microseconds. Findings: [Provider SDK options research](https://github.com/qodesmith/unimatrix-zero/blob/research/provider-sdk-options/docs/research/provider-sdk-options.md), [Provider drivers, process model and IPC event list](https://github.com/qodesmith/unimatrix-zero/issues/38).

## Considered Options

- **Drivers in the main process.** Rejected: a stuck driver would freeze the database and every window.
- **One utility process for both Providers.** Rejected: one Provider's crash would fail the other's in-flight Replies.
- **Direct `MessagePortMain` from driver to renderer.** Rejected: two consumers (renderer and main) could disagree about what a Reply contains.

## Consequences

- **The renderer never talks to a Provider host.** On connect or reload it gets a `SNAPSHOT` from main (Provider statuses, account, usage, MCP server statuses, and any in-progress Reply as displayed), then the live events, with no gap and no duplicates.
- **Main owns crash handling.** On `child-process-gone` it saves the in-flight Reply as failed with the text it last displayed, restarts that host with backoff (1 s, 5 s, 30 s, then a "Download <Provider> again" band, per [#40](https://github.com/qodesmith/unimatrix-zero/issues/40)), and holds nothing: while the host restarts, Send is off and the draft stays in the Input, and the user sends it once the host reports ready, the same as offline. Amended: this bullet first had main queue new Prompts for the Provider; [#38](https://github.com/qodesmith/unimatrix-zero/issues/38) replaced that with Send off and the draft kept.
- **A crashed Reply never re-runs on its own**: a re-run could repeat tool actions or loop on a Prompt that crashes the vendor program.

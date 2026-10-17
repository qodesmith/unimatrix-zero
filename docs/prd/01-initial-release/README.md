# Unimatrix Zero v1 PRD

Unimatrix Zero is a free desktop app (Electron; Mac, Windows, Linux) that drives the user's existing Claude and ChatGPT subscriptions. Every conversation is a **Tree** that branches at any Reply, shown either as a whole on a canvas or one Thread at a time as a chat.

This document is the v1 spec, assembled from the decisions on the [Unimatrix Zero v1 spec](https://github.com/qodesmith/unimatrix-zero/issues/1) map. It is an index with detail: each section states what was decided and links the ticket that holds the full reasoning. The vocabulary is [`CONTEXT.md`](../../../CONTEXT.md); the hard-to-reverse choices are in [`docs/adr/`](../../adr/). Where this document, a ticket and an ADR disagree, the ADR wins, then the ticket's latest resolution or amendment, then this document.

**Status:** complete except for one live check. Native Windows Sandbox behaviour is written from the vendor docs; the live check is [#58](https://github.com/qodesmith/unimatrix-zero/issues/58), and any correction goes into ADR 0018 by PR.

## Sections

Each section is its own file, sized to be read alone by whoever works one implementation issue. Sections that rest on unverified facts end with a "Verify while building" list for that issue to inherit.

1. [Product](./01-product.md)
2. [Scope](./02-scope.md)
3. [Conversation model](./03-conversation-model.md)
4. [Connecting a Provider](./04-connecting-a-provider.md)
5. [Canvas mode and chat mode](./05-canvas-mode-and-chat-mode.md)
6. [The Input: Prompts, attachments, Models](./06-the-input-prompts-attachments-models.md)
7. [Replies](./07-replies.md)
8. [System prompts, the Tools panel, approvals and YOLO](./08-system-prompts-the-tools-panel-approvals-and-yolo.md)
9. [Workspaces](./09-workspaces.md)
10. [The Sandbox](./10-the-sandbox.md)
11. [Subagents](./11-subagents.md)
12. [Sidebar, Collections and search](./12-sidebar-collections-and-search.md)
13. [Summaries](./13-summaries.md)
14. [Export, Archive and restore](./14-export-archive-and-restore.md)
15. [Disk usage](./15-disk-usage.md)
16. [Usage and limits](./16-usage-and-limits.md)
17. [Settings and Themes](./17-settings-and-themes.md)
18. [Offline, reconnect and error states](./18-offline-reconnect-and-error-states.md)
19. [Reports and Diagnostics](./19-reports-and-diagnostics.md)
20. [Distribution, updates and vendor programs](./20-distribution-updates-and-vendor-programs.md)
21. [Architecture](./21-architecture.md)
22. [Repo, build, test and release](./22-repo-build-test-and-release.md)
23. [Visual identity](./23-visual-identity.md)

## Index of decisions, ADRs, prototypes and research

**ADRs**

| ADR                                                                               | Decision                                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [0001](../../adr/0001-app-owns-the-tree.md)                                       | The app owns the Tree; Provider sessions are disposable copies                            |
| [0002](../../adr/0002-uuidv7-ids.md)                                              | UUIDv7 ids everywhere                                                                     |
| [0003](../../adr/0003-migration-foreign-key-guard.md)                             | Migrations behind a backup and a foreign-key guard                                        |
| [0004](../../adr/0004-app-keeps-provider-session-data.md)                         | The app keeps its own copy of Provider session data; deleting rewinds the session         |
| [0005](../../adr/0005-no-ai-library.md)                                           | No AI library                                                                             |
| [0006](../../adr/0006-unsigned-distribution.md)                                   | Unsigned distribution; the infrastructure and secrets rules                               |
| [0007](../../adr/0007-thin-shell-signed-app-bundles.md)                           | Thin shell with signed app bundles; versioning; the manifest                              |
| [0008](../../adr/0008-app-managed-vendor-programs.md)                             | App-managed vendor programs with isolated config                                          |
| [0009](../../adr/0009-themes-are-versioned-token-only-json.md)                    | Themes are versioned, token-only JSON                                                     |
| [0010](../../adr/0010-linked-folder-holds-one-thread.md)                          | A linked folder holds one Thread; one hidden store per Workspace; never delete on its own |
| [0011](../../adr/0011-archives-are-their-own-versioned-format.md)                 | Archives are their own versioned format                                                   |
| [0012](../../adr/0012-stable-identity-separate-from-display-name.md)              | Stored identity is separate from the display name                                         |
| [0013](../../adr/0013-utility-process-per-provider-main-is-the-hub.md)            | One utility process per Provider; main is the hub                                         |
| [0014](../../adr/0014-electron-security-posture.md)                               | Electron security posture                                                                 |
| [0015](../../adr/0015-types-derive-from-schemas-ipc-contract.md)                  | Types derive from schemas; the IPC contract is its own source of truth                    |
| [0016](../../adr/0016-releases-built-and-signed-on-the-maintainers-machine.md)    | Releases are built and signed on the maintainer's machine                                 |
| [0017](../../adr/0017-reports-go-through-a-stateless-relay-into-github-issues.md) | Reports go through a stateless relay into GitHub Issues                                   |
| [0018](../../adr/0018-commands-run-inside-the-vendor-sandbox.md)                  | Commands run inside the vendor Sandbox; YOLO removes it                                   |
| [0019](../../adr/0019-canvas-is-a-display-for-the-tree.md)                        | Canvas mode is a display for the Tree, rendered with React Flow; chat mode is a slideout  |

Decisions deliberately left without an ADR, because they sit behind one function or are cheap to reverse: the replay mechanism (#10), Summaries (#28), disk usage (#29), the subscription-terms posture (#21).

**Prototypes** (each on its `prototype/<name>` branch with a `LIKES.md` verdict): canvas-mode-ux (#14), onboarding-sign-in (#16), workspace-file-tree (#26), export-archive-summary (#30), tree-sidebar (#34), usage-display (#36), error-states (#40), visual-identity (#42), search-palette (#44).

**Research** (each on its `research/<name>` branch under `docs/research/`): subscription-session-capabilities (#2), t3code-conversation-storage (#3), hidden-sign-in (#4), unsigned-distribution (#5), ai-library-landscape (#6), cross-provider-continuation (#7), sqlite-in-electron (#8), stop-reply-upstream (#23), workspaces-mechanics (#25), provider-session-backup (#11), subagents (#31), usage-data (#35), provider-sdk-options (#37), claude-setup-token (#40), full-text-search (#43), subscription-terms (#21), vendor-sandboxing (#49), sandbox-live-tests (#53).

**Grilling tickets:** #9, #10, #11, #12, #13, #18, #19, #20, #21, #22, #24, #27, #28, #29, #32, #33, #38, #39, #41, #47, #49, #56. **Task tickets:** #55 (macOS desktop apps, done), #58 (Windows, open).

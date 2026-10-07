# A linked folder holds one Thread; every Workspace has its own hidden store

A linked folder is the working copy of exactly one Thread at a time; other Threads run in working copies in `userData`, and the folder changes Threads only when the user presses "Put this Thread in the folder" (or turns on the per-Workspace "Keep the folder in sync with the selected Thread", off by default). Every Workspace, linked or app-owned, git repo or not, snapshots into its own hidden git store in `userData` with one index per working copy, never into the user's `.git`. Linking should feel like `cd project && claude` (dev servers, `node_modules`, `.env` and uncommitted work just work), while branching still gives each Thread coherent files and nothing in the user's repo changes. Findings: [Workspaces](https://github.com/qodesmith/unimatrix-zero/issues/24), [Workspaces: snapshots, working copies and linked folders](https://github.com/qodesmith/unimatrix-zero/issues/25).

## Considered Options

- **Always a working copy; the real folder is untouched until the user applies a Branch.** Rejected: every Branch pays for building its folder and bringing in ignored files, and "apply" becomes the main workflow, close to the merge UI we excluded.
- **Real folder until the first Fork, then working copies.** Rejected: the same costs paid later, plus a mode change that surprises users mid-Tree.
- **Snapshots as hidden refs in the user's `.git`, with `git worktree` for extra Branches** (T3 Code's approach). Rejected: refs and worktrees show up in `git log --all`, `git worktree list` and git GUIs, and non-git folders would need a second code path.

## Consequences

- **Swaps snapshot first and replace, never merge.** Uncaptured hand edits become a User edit on the outgoing Thread. With sync on, the folder never swaps mid-Reply; it catches up when the Reply finishes.
- **The store reads the project's ignore rules itself** (every nested `.gitignore` plus `.git/info/exclude`), since its git dir is separate, plus default excludes such as `node_modules`.
- **Every version of every file is kept.** Files of 100 MB or more keep their contents in a per-Workspace folder next to the store, named by hash, with a pointer in the Snapshot, because git copes badly with very large files. They're placed in working folders as copy-on-write clones where the filesystem allows, otherwise as full copies, never as links: an edit through a link would change the stored version. A size-and-modified-time check skips re-hashing unchanged files; an Archive always re-hashes.
- **The app never deletes data on its own**, whether time passes or disk runs low. Working copies stay until their leaf is deleted or their Thread moves into the folder. Stored data (Snapshots, large-file versions, attachments, Provider session data) is removed only after the user deletes what it belonged to. Disk space is the user's to manage, so the app shows it.
- **Amended:** this reverses [#25](https://github.com/qodesmith/unimatrix-zero/issues/25)'s large-file rule (name, size and hash only, "No earlier version kept") and its 30-day eviction of working copies. Together they could destroy the only copy of a large file: by eviction, or by a folder swap overwriting it.
- **Working copies don't contain ignored files from the store.** They get them from a copy-on-write clone of the folder where the filesystem allows it, otherwise a capped copy of small ignored files, plus an optional per-Workspace Setup command when commands are allowed.
- **Exposing Branches as real git branches is out of scope for v1.**

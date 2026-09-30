# Workspaces: snapshots, working copies and linked folders

Research for [#25](https://github.com/qodesmith/unimatrix-zero/issues/25), which feeds the Workspaces grilling ticket [#24](https://github.com/qodesmith/unimatrix-zero/issues/24), part of the map [#1](https://github.com/qodesmith/unimatrix-zero/issues/1). Researched 2026-09-30.

**Question:** What does it take for a Workspace's files to branch along with a Tree? How does T3 Code do it for linear threads, and what changes for a branching Tree?

**Sources checked:**

- T3 Code at `main@c2fa9fc9`: `apps/server/src/checkpointing/`, `apps/server/src/vcs/`, `apps/server/src/orchestration/`, the provider adapters, `apps/web`, and `packages/contracts`.
- Claude Agent SDK `@anthropic-ai/claude-agent-sdk@0.3.285` (`sdk.d.ts`), which bundles Claude Code 2.1.285. Also the official docs pages [sessions](https://code.claude.com/docs/en/sessions), [permissions](https://code.claude.com/docs/en/agent-sdk/permissions), [session storage](https://code.claude.com/docs/en/agent-sdk/session-storage) and [worktrees](https://code.claude.com/docs/en/worktrees).
- Codex `openai/codex` at `main@92bc601`, plus `codex-cli 0.159.0` for the live tests.
- git 2.56.0 and its `git-fsmonitor--daemon` manual page.
- The Node.js `fs.watch` docs ([`doc/api/fs.md`](https://github.com/nodejs/node/blob/main/doc/api/fs.md)), chokidar 5.0.0 and `@parcel/watcher` 2.6.0 (their READMEs).

**Live tests** ran on 2026-09-30 on an Apple-silicon Mac (APFS) with the author's subscriptions:

- **Claude:** Haiku 4.5.
- **Codex:** `gpt-5.6-luna` at low effort.
- **"Real project":** a copy of the T3 Code repo with 23,268 tracked files, plus `bun install`, which added 3.1 GB and about 222k files of `node_modules` (245,696 files in total).

Paths below are relative to each repo's root. Claims that could not be verified are marked **(unverified)**.

## Short answer

- **The proposed mechanics in #24 hold up**, with three changes:
  1. **Keep a persistent index for each working copy.** T3's fresh temporary index re-hashes every file, about 2.2 s per snapshot on the real project, versus about 150 ms with a persistent index.
  2. **Don't use `git worktree` for app-owned Workspaces.** It writes a `.git` file into the folder. Use one hidden store with a separate index file per working copy instead.
  3. **Skip the commit when the tree hash is unchanged.** T3 never skips, but the check is free.
- **Both providers can move a session to a new folder, including a fork from an earlier Reply.** No replay is needed.
  - **Claude:** `resume` + `forkSession: true` + `resumeSessionAt: <message uuid>` + a new `cwd`. The model sees the new cwd, and the forked transcript is filed under the new folder.
  - **Codex:** `thread/fork { threadId, lastTurnId, cwd }`. `turn/start` also takes a `cwd` override.
  - Both were tested live.
- **Confining writes to the Workspace, with shell off, works on both providers, and writes inside it are auto-approved.**
  - **Claude:** `tools: [Read, Write, Edit, Glob, Grep]` + `permissionMode: 'acceptEdits'`. Writes outside cwd and `additionalDirectories` reach `canUseTool`, and so do `..` paths and symlinks that resolve outside it.
  - **Codex:** `workspace-write` + `features.shell_tool = false`. Patches outside the folder raise `item/fileChange/requestApproval`.
- **Detecting user edits by snapshotting at the start of each Turn is fast enough:** about 150 ms on 23k files. A watcher is only for keeping the UI live.
  - On macOS, use `@parcel/watcher` or `fs.watch({recursive: true})`, which both start in about 1 ms.
  - **Not chokidar.** chokidar 5 took 1.5 s and 380 MB even with `node_modules` ignored, and crashed with `EMFILE` without the ignore.
- **Cold-Turn token cost is much lower than #7's "36k" suggests.** Most of that figure came from settings the app controls:
  - Claude's claude.ai account connectors, which are on by default: about 30k tokens.
  - The `claude_code` system-prompt preset: about 6k tokens.
  - With both off, a plain Tree's cold Turn is about 380 tokens and a Workspace Tree's (5 file tools) about 3,700.
  - Codex's floor is about 12.7k tokens by default, or about 2.2k fully stripped.
- **Linked folders are the one real product decision.** T3 runs in the user's folder by default and makes worktrees opt-in. It never carries uncommitted changes or ignored files into a worktree; a user "setup script" handles those. Options and consequences are in section 3.

## 1. Snapshots

### How T3 Code captures a checkpoint

Everything is in `apps/server/src/vcs/GitVcsDriver.ts`; `CheckpointStore.ts` only delegates to it.

- **Ref name:** `refs/t3/checkpoints/<base64url(threadId)>/turn/<turnCount>` (`checkpointing/Utils.ts:4-9`). Turn 0 is a baseline taken before the first turn.
- **Temporary index:** a file `t3-checkpoint-index-<uuid>` in the repo's git dir, passed as `GIT_INDEX_FILE`. Author and committer are set to "T3 Code" (`GitVcsDriver.ts:788-799`).
- **Seeding the index:** if `HEAD` exists, T3 **copies the real `.git/index`** (to keep git's file-stat cache) and runs `read-tree --reset HEAD`. Otherwise it runs `read-tree HEAD`. It always passes `-c core.fsmonitor=false`, handles cone-mode sparse checkouts, and refuses non-cone ones (`:811-941`).
- **Staging:** `git -c core.fsync=objects,reference -c core.fsyncMethod=fsync add -A -- .` (`:943-1000`).
  - Plain `add -A` honours `.gitignore`, so `node_modules` and `.env` are never captured.
  - If staging fails, T3 retries while excluding nested repos that have no commits (at most 64, within 5 s).
- **Committing:** `write-tree`, then `commit-tree <tree> -m "t3 checkpoint ref=<ref>"`, then `update-ref <ref> <commit>` (`:1005-1044`).
  - The commits have **no parent**. Each one is a standalone snapshot, not a history.
  - The temporary index and its `.lock` are always deleted.
  - Checkpoint writes are fsync'd because "unsynced refs under `refs/t3/**` broke fetch/push after crashes" (`:767-776`).
- **When it runs** (`orchestration/Layers/CheckpointReactor.ts`):
  - A baseline on turn start, but only if that ref doesn't exist yet (`:461-509`, `:695-717`, `:914-957`).
  - `turn/<n+1>` on `turn.completed` or `turn.aborted`, followed by a numstat diff from `turn/<n>` that is sent to the UI as `thread.turn.diff.complete` (`:393-459`, `:959-996`).
- **No skip.** There is no tree-hash comparison, so every turn gets a ref. Identical trees are deduplicated only by git's object store.
- **Restore** (`GitVcsDriver.ts:1052-1126`):
  1. `git restore --source <oid> --worktree --staged -- .`
  2. `git clean -fd -- .`, which deletes untracked files but keeps ignored ones.
  3. `git reset --quiet -- .`, so the user's staging area matches `HEAD` again.
- **Diff:** `git diff --numstat -z` and `--patch` between two checkpoint commits, capped at 10 MB of output and ignoring whitespace by default (`:1128-1192`, `CheckpointDiffQuery.ts:86`).
- **Non-git folders:** checkpoints are silently skipped (`CheckpointReactor.ts:236-238`), and revert then fails with "Checkpoint workspace is unavailable or is not a git repository" (`:803-811`).
- **Pruning:** refs are deleted only when a revert drops later turns (`:877-889`). Nothing deletes them when a thread is deleted, and there is no GC.
- **Revert rewinds files and conversation together** (`:766-910`):
  - Files are restored only if the thread is **alone in its own worktree**. It refuses if any other thread's cwd equals, contains or is inside it (`:720-764`).
  - Then it rolls the provider back: Claude via `forkSession(sessionId, {dir, upToMessageId})` plus a restart with `resume` (`ClaudeAdapter.ts:5323-5500`); Codex via `thread/revert {threadId, beforeTurnId}` (`CodexSessionRuntime.ts:1283-1297`).
  - This is T3's linear version of "move to an earlier Reply", and the lock shows the problem a branching Tree has to solve: two conversations cannot share one folder.

### Measured speed and disk cost

Scripts: `/tmp/uz-ws/bench/snap.sh` and `hidden.sh`. Times are from two runs each (T3 repo) or one run (codex repo).

| Operation | codex repo (8.8k files) | T3 repo + node_modules (23k tracked, 245k total) |
|---|---|---|
| `git status` | 2,534 ms (first run after copying, cold) | 136-151 ms |
| Snapshot, **fresh** temp index seeded by `read-tree HEAD` | 518 ms | **2,200 ms** |
| Snapshot, temp index **copied from `.git/index`** (T3's way) | – | 172 ms |
| Snapshot, **persistent** per-working-copy index, nothing changed | 73 ms | **147-158 ms** |
| Same, one file edited | 80 ms | 155-163 ms |
| `diff-tree -r --numstat` between two snapshots | 14 ms | 15 ms |
| `ls-tree -r` (whole file list at a Reply) | 18 ms | 26 ms |
| `cat-file -p <tree>:README.md` (view one file at a Reply) | 13 ms | 13 ms |
| Materialise a snapshot into an empty folder (`read-tree` + `checkout-index -a`) | 28 ms + 909 ms | 45 ms + 2,462 ms |
| `git worktree add --detach` | 898 ms | 2,419 ms |

- **The index is what makes snapshots cheap.** A fresh index has no stat information, so `add -A` re-reads and re-hashes every file. T3 avoids that by copying the real index. A branching Tree has no single "real" index to copy, since every working copy has its own state, so **each working copy should keep its own persistent index file**. That keeps snapshots at about 150 ms on a 23k-file project.
- **Disk cost is tiny for text edits.** A one-file edit snapshot added 9 loose objects (264 KB, mostly new tree objects along the edited path). Git stores each unique blob once and `git gc` packs them. For an app-owned store, the whole cost of a Workspace is roughly its unique content, compressed.
- **Viewing a Reply's files never touches disk.** `ls-tree` and `cat-file` answer in 13-26 ms, which confirms #24's "viewing is not a checkout".
- **Creating a working copy costs about 1 s per 10k files.** Almost all of it is writing the files. This is a one-time cost per new Branch working copy.

### Can a Reply that changed nothing skip the commit?

Yes. `write-tree` is deterministic: an unchanged working copy produces the same tree hash, which was confirmed live (`hidden.sh`: "same-tree").

1. Snapshot with the persistent index.
2. Compare the tree hash to the parent Reply's snapshot tree.
3. If they are equal, store the parent's commit SHA on this Reply and write no commit or ref.

This also covers the Workspace Trees where most Replies are pure chat.

## 2. Hidden git for app-owned Workspaces

- **What works:** one bare store per Workspace (`git init --bare <appData>/workspaces/<id>.git`), and every git call passes three variables:
  - `GIT_DIR=<store>`
  - `GIT_WORK_TREE=<working copy>`
  - `GIT_INDEX_FILE=<store>/<workingCopyId>.idx`

  Many working copies can share one store, each with its own index. None of them contains a `.git`. This was tested live (`hidden.sh`):
  - Two working copies.
  - A snapshot of each.
  - A Branch working copy created from a snapshot in 734 ms (4k files).
  - `diff-tree` between Branches showing `D apps/server/package.json` / `A new.txt`.
  - `find … -name .git` returned 0 in both folders.
- **Problem: `git worktree add` against a hidden store writes a `.git` file into the folder.** Live result: `gitdir: /private/tmp/uz-ws/bench/store.git/worktrees/wcC`. That breaks "no `.git` appears". It also has a side effect: **both agents now see a git repo.**
  - Claude Code adds git status to its context (**token cost unverified**) and may run git.
  - Codex treats `.git` as read-only under `workspace-write`, including following a `gitdir:` file (`codex-rs/protocol/src/permissions.rs:860`, `:1589-1622`).
  - So app-owned Workspaces should **not** use `git worktree`. Plain `read-tree` + `checkout-index` into an empty folder does the same job.
- **Other caveats of a hidden store:**
  - Never export `GIT_DIR` / `GIT_WORK_TREE` into the agent's environment. Set them only on the app's own git calls, or the agent's shell commands would act on the hidden store.
  - Keep working copies outside any git repo. A folder inside a repo resolves to that repo. Claude Code also refuses to bind a worktree when "git resolves its working tree to" an enclosing repo ([worktrees docs](https://code.claude.com/docs/en/worktrees)). The app's data folder is fine.
  - A working copy's index is not a registered worktree, so `git gc` doesn't know about it. Objects that are staged but never committed could be pruned after gc's grace period (2 weeks by default). This is harmless as long as every snapshot is committed to a ref before it is relied on. Delete refs for pruned Branches, then `gc`, to reclaim space.
  - Use unique ref names per Reply (e.g. `refs/uz/replies/<replyId>`) so concurrent Branches never race on a ref. Git's object store is safe for concurrent writers. Each index has its own `.lock`.
  - **Always ship default excludes.** An app-owned or non-git folder has no `.gitignore`. Live: snapshotting 222k `node_modules` files with no excludes took **157 s and grew the store to 1.4 GB**, versus 38 ms for an unchanged 4k-file tree. Put `node_modules/`, `.DS_Store`, build outputs, etc. in the store's `info/exclude`, and consider a per-file size cap. T3 has none (`GitVcsDriver.ts`, no size filtering).

## 3. Linked folders

### What T3 Code does

- **The agent works in the user's own folder by default.** `ThreadEnvMode = "local" | "worktree"` (`packages/contracts/src/environment.ts:59`), labelled "Current checkout" / "New worktree" (`apps/web/src/components/BranchToolbar.logic.ts:93-95`).
  - The default is `"local"`, resolved from project setting, then environment setting, then `t3.json`, then built-in (`packages/contracts/src/t3ProjectFile.ts:120`, `apps/web/src/hooks/useHandleNewThread.ts:151-163`).
  - The mode is chosen per thread and locked once the thread exists (`BranchToolbar.tsx:148`).
- **Worktree mode** runs `git worktree add -b t3code/<8 hex> <~/.t3/worktrees/<repo>/<branch>> <base>` (`GitVcsDriverCore.ts:3062-3200`, `packages/shared/src/git.ts:13,95-109`).
  - The base is fetched from `origin` first by default (`newWorktreesStartFromOrigin`).
  - The branch is renamed by an LLM after the first turn (`ProviderCommandReactor.ts:909-957`).
- **Uncommitted changes are not carried over.** The worktree is checked out from a committed ref, with no stash or copy.
- **Ignored files (`node_modules`, `.env`) are not copied.** Instead a per-project "setup script" (`runOnWorktreeCreate`) runs in a terminal inside the new worktree, with `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` set (`packages/shared/src/projectScripts.ts:58-75`, `apps/server/src/project/ProjectSetupScriptRunner.ts:341-372`).
- **Non-git folders:** worktree mode falls back to the project checkout, or errors if a worktree was required (`apps/server/src/ws.ts:1332-1520`). Checkpoints are skipped.
- **No merge back.** The only git actions are commit, push and create PR (`packages/contracts/src/git.ts:12-18`).
- **Cleanup:** deleting a thread runs `git worktree remove --force`. Missing worktrees are recreated from their branch on resume (`GitVcsDriverCore.ts:3439-3495`, `ProviderCommandReactor.ts:475-525`).
- **Claude Code does the same.** It creates worktrees under `.claude/worktrees/<name>`. Gitignored files are copied only if listed in a `.worktreeinclude` file (`.gitignore` syntax, "only files that match a pattern and are also gitignored are copied") ([worktrees docs](https://code.claude.com/docs/en/worktrees)).

### Options for a branching Tree

**Snapshots work the same in every option:** hidden refs in the user's own `.git`, written through a temporary or per-working-copy index. That never touches their branches, their staging area or `git status` (confirmed live: status unchanged after 7 hidden refs).

**Caveat:** refs under `refs/` show up in `git log --all` and in GUI clients that list all refs (live: 5 snapshot commits appeared in `git log --all`). They are pushed only by `push --mirror` or explicit refspecs.

**A. The first active leaf works in the real folder; extra Branches get worktrees.** This is T3's default, extended.

- **Consequences:**
  - It feels like `cd project && claude`: `node_modules`, `.env`, dev servers and uncommitted changes all just work.
  - It is asymmetric. One Branch "owns" the real folder, and moving to another Branch means either swapping the real folder's contents (touching the user's files) or opening that Branch's worktree.
  - The user's own edits and the AI's interleave in the same folder. This is fine, because the Turn-start snapshot records them (section 6).

**B. Always a worktree; the real folder is untouched until the user applies a Branch.**

- **Consequences:**
  - Safe and symmetric.
  - Every Branch, including the first, needs a working copy (about 1-2.5 s per 10-23k files) plus its ignored files.
  - An "apply this Branch to my folder" action is needed. That is a merge UI in disguise, which #24 excludes, unless it is plain "copy files over".

**C. Hybrid:** start as A; on the first Fork, move the real folder's Branch into a worktree too, or leave it. This has the same costs as A and B at different moments.

**Uncommitted changes when linking**

- `add -A` through a temporary index captures them, tracked and untracked, but not ignored files.
- So the **root snapshot can include uncommitted work**, and worktrees created from it carry it. That is better than T3, which drops it.
- Nothing is lost in the user's folder, because the snapshot never touches their index.

**Ignored files in new worktrees.** Choices, cheapest first:

1. **A `.worktreeinclude`-style list** of small ignored files to copy (`.env*`). This is Claude Code's approach.
2. **A copy-on-write clone** of big ignored folders. On APFS, a single `clonefile()` of the whole 3.5 GB / 245k-file project took **10 s** and used almost no extra disk. `cp -c -R`, which clones file by file, took 57 s.
   - Linux (btrfs/XFS reflinks) and Windows (ReFS/Dev Drive block cloning) have equivalents **(unverified)**.
   - On ext4 and NTFS it falls back to a full copy.
3. **Symlinking** `node_modules` into the worktree. It is instant, but some tools resolve through symlinks and break **(unverified per tool)**.
4. **A setup script** (T3's approach, e.g. `bun install`). It is correct, but slow and developer-only.

**Folders that aren't git repos**

- **Hidden store:** a hidden store (section 2) with `GIT_WORK_TREE` set to the user's folder works the same way. The costs:
  - It needs default excludes and size caps (157 s / 1.4 GB without them).
  - There is no `.gitignore` to learn from.
  - Branch working copies must live elsewhere (the app's data folder), since there is no repo to hang a worktree on.
- **Refusing** is T3's behaviour for checkpoints, and would block the "parent with a folder of school PDFs" case.

**Exposing Branches as real git branches (for developers).** Creating a branch per Branch (`git worktree add -b uz/<tree>/<branch>`) is one flag away, and it gives developers merge, diff and PR tools for free. It clutters `git branch` for everyone else, so it could be a setting.

## 4. Sessions across folders

### Claude Agent SDK (tested live)

Scripts: `/tmp/uz-ws/claude/test1-sessions.mjs`, `test1d-forkhelper.mjs`.

**Where sessions live**

- Transcripts live under `~/.claude/projects/<cwd with every non-alphanumeric char replaced by ->/<sessionId>.jsonl`.
- The docs say "You can resume from any working directory". Claude Code searches the current project, then every other project, from CLI v2.1.223 on. A cross-project hit resolves only if exactly one project holds the ID ([sessions docs](https://code.claude.com/docs/en/sessions)).

**The setup:** a session in `dirA` read a file and stored a codeword.

| Call from `dirB` | Result | Where the transcript goes |
|---|---|---|
| `resume: id, cwd: dirB` | Same session, history kept; the model reports cwd `dirB` (its environment block was rebuilt) | **Appended to the original file in dirA's project folder**, entries stamped `cwd=dirB`. `listSessions({dir: dirB})` doesn't list it |
| `resume: id, forkSession: true, cwd: dirB` | New session ID, history kept, cwd `dirB` | New file in **dirB's** project folder, with all entries rewritten to `cwd=dirB`. Message UUIDs are kept |
| + `resumeSessionAt: <assistant uuid of turn 1>` | The fork remembered turn 1's codeword but not turn 2's, so the cut worked; cwd `dirB` | New file in dirB's folder |
| Standalone `forkSession(id, {upToMessageId})` helper (`sdk.d.ts:817-854`) | New ID with **remapped** UUIDs | File in the **source's** folder; `getSessionInfo().cwd` stays dirA |

- **Branching from a Reply into a new working copy is one call:** `query({ options: { resume: parentSessionId, forkSession: true, resumeSessionAt: reply.lastAssistantUuid, cwd: branchWorkingCopy } })`.
  - The streamed `SDKAssistantMessage.uuid` is the transcript uuid, so the app can store it on each Reply.
  - This is the same mechanism T3 uses for its rollback (`ClaudeAdapter.ts:5323-5500`).
- **Session stores are the exception.** `getSessionMessages` / `getSessionInfo` search every project folder when `dir` is omitted (`sdk.d.ts:863-902`). But with a custom `sessionStore`, the `projectKey` defaults to the sanitized cwd (`sdk.d.ts:6360-6366`), and the docs say to "resume from a working directory matching the original run's". So if the app adopts `sessionStore` (as #7 suggested for cross-provider seeding), it must key sessions itself.
- **(Unverified)** `systemPrompt.snapshot` records the system prompt once and reuses it on resume (`sdk.d.ts:2346-2373`, "rolling out"). In this test the cwd *was* refreshed. Whether a snapshotted prompt would pin the old cwd was not tested.
- **(Inferred, not measured)** The environment block, which includes the cwd, is in the system prompt. So a fork into a new folder should miss the prompt cache for the whole Thread, the same cost as a cold resume (#7).

### Codex app-server (tested live)

Scripts: `/tmp/uz-ws/codexq/test1-cwd-fork.mjs`.

- **Every entry point takes a `cwd`:**
  - `thread/resume` (`codex-rs/app-server-protocol/src/protocol/v2/thread.rs:390`)
  - `thread/fork` (`:584`)
  - `turn/start` (`v2/turn.rs:206`, not experimental: "this turn and subsequent turns")
  - `thread/settings/update` (experimental)
- **Forking at an earlier Reply** works at turn granularity:
  - `thread/fork.lastTurnId` (stable, inclusive).
  - `beforeTurnId` (experimental, exclusive).
  - `thread/revert {threadId, beforeTurnId}` truncates in place. There is no `thread/rollback` in this version.
- **Live results:**
  - `thread/fork` with `cwd: dirB` kept the history, and the model listed both `dirA` and `dirB` as working directories.
  - `turn/start` with `cwd: dirC` on the original thread did the same, and `thread/read` then reported `cwd = dirC`.
  - The environment context is appended as a diff rather than rewritten (`core/src/context/world_state/environment.rs:108-135`). The workspace roots follow the new cwd.
- **Storage:** rollouts are by date (`~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<id>.jsonl`), not by project. A fork's rollout **does not copy** the parent: it stores `forked_from_id` + `forked_from_ordinal_exclusive`. So deleting a parent thread may break its forks **(unverified what happens)**.
- **Cache:** the fork's first turn had **0 cached** of 17,747 input tokens. A per-turn `cwd` change on the same thread kept 9,984 of 14,164 cached.

**Replay is not needed on either provider.** If it ever were (for example after a provider switch), the cost is the cold-Turn cost measured in #7: the whole Thread as uncached input once.

## 5. Tool scoping (shell off)

### Claude

Scripts: `/tmp/uz-ws/claude/test2*.mjs`.

**The options** (`sdk.d.ts` line numbers):

- `tools` defines which built-ins exist (`:1624-1636`).
- `allowedTools` only auto-approves (`:1570-1577`).
- `disallowedTools` removes tools (`:1592-1597`).
- `PermissionMode` is `default | acceptEdits | bypassPermissions | plan | dontAsk | auto` (`:2471`).
- The docs give the evaluation order: hooks → deny rules → ask rules → mode → allow rules → `canUseTool`. `acceptEdits` auto-approves edits "only to paths inside the working directory or `additionalDirectories`" ([permissions](https://code.claude.com/docs/en/agent-sdk/permissions)).

**Live results.** Setup: `tools: [Read, Write, Edit, Glob, Grep]`, `acceptEdits`, cwd `dirA`, `additionalDirectories: [extra]`, and a `canUseTool` that logs and denies.

| Attempt | Asked? | Result |
|---|---|---|
| Write `dirA/ok.txt` | No | Created |
| Write `extra/extra.txt` | No | Created |
| Write `../outside.txt` | Yes: "Path is outside allowed working directories" | Denied |
| Write `dirA/../traversal.txt` | Yes; the path was normalised first | Denied |
| Write through symlink `dirA/link → outsideDir` | Yes: "resolves through a symlink … outside" | Denied |
| Read a file outside cwd | Yes (suggests a `Read(//path/**)` rule) | – |
| `default` mode, write inside cwd | Yes | – |
| `dontAsk` mode, write inside cwd | No | Denied outright |

- **Writes inside the Workspace can be silently auto-approved**, and anything else reaches the app's `canUseTool`. The app can deny it, or ask the user for linked folders. Denials are also listed in `result.permission_denials`.
- **Surprise: `tools` does not remove claude.ai account connectors.** Even with `tools: []`, init listed about 60 `mcp__claude_ai_*` tools (Gmail, Drive, Calendar, …). Setting `settings: { disableClaudeAiConnectors: true }` (`sdk.d.ts:6841-6843`) removed them. `strictMcpConfig` may also work **(unverified)**. **The app must set this**, both for privacy and for cost (section 7).

### Codex

Scripts: `/tmp/uz-ws/codexq/test2-approvals.mjs`.

- **Sandbox and approval values:**
  - Sandbox: `read-only | workspace-write | danger-full-access` (`v2/shared.rs:311`).
  - `workspaceWrite` takes `writableRoots`, `networkAccess`, `excludeTmpdirEnvVar` and `excludeSlashTmp`. **`/tmp` and `$TMPDIR` are writable by default** (`protocol/src/permissions.rs:822-837`).
  - Approval policy: `untrusted | on-request | never | granular{…}` (`v2/shared.rs:182-197`).
- **Who decides** (`assess_patch_safety`, `core/src/safety.rs:67-125`):
  - Under `untrusted`, every patch asks.
  - Otherwise a patch whose paths all fall inside the writable roots is auto-approved, **if a platform sandbox is available**.
  - A patch outside them asks the user, or is rejected under `never`.
- **Live result** (`workspace-write` + `on-request`, `/tmp` excluded):
  - `dirA/ok.txt` was created with no request.
  - `/tmp/uz-ws/codexq/outside.txt` raised one `item/fileChange/requestApproval`. The possible decisions are `accept | acceptForSession | decline | cancel` (`v2/item.rs:115-124`). It was declined, and the file was not created.
- **Shell off:**
  - `features.shell_tool = false` removes `shell` and `exec_command` (`core/src/tools/spec_plan.rs:1079-1088`).
  - There is no flag to remove `apply_patch` alone (`:1269`).
  - `environments: []` (experimental) removes environment access entirely.
- **Platforms** (`sandboxing/src/manager.rs:49-63`):
  - macOS uses Seatbelt.
  - Linux uses bubblewrap/seccomp (WSL2 works, WSL1 is rejected).
  - Windows uses a restricted-token sandbox only when enabled. **Without a sandbox, in-workspace patches are not auto-approved either** (`safety.rs:95-100`). So on Windows, "auto-approve writes inside the Workspace" depends on the Windows sandbox being on **(behaviour on a real Windows machine unverified)**.
- **The `.git` folder is read-only** under `workspace-write`, including a worktree's resolved `gitdir` (`permissions.rs:860`, `:1589-1622`).

## 6. Detecting user edits

**Snapshot at the start of each Turn.** With a persistent index this costs about the same as `git status`: about 150 ms on 23k files and 73 ms on 9k (section 1).

- It is correct on every OS, because git compares file stat data and re-hashes only changed files.
- No daemon is needed.
- If the tree differs from the leaf Reply's snapshot, record a user edit and tell the AI. This is what #24 proposes, and it holds.

**A watcher is for keeping the UI live only.** Script: `/tmp/uz-ws/watch/c2.mjs`, one watcher per process, on the real project.

| Watcher (macOS) | Startup | Memory (RSS) | Event latency |
|---|---|---|---|
| chokidar 5, `node_modules` + `.git` ignored | 1,547 ms | 383 MB | 15 ms |
| chokidar 5, nothing ignored | **crashed: `EMFILE: too many open files`** | – | – |
| `@parcel/watcher` 2.6 (FSEvents), either way | 1 ms | 56 MB | 15-16 ms |
| `fs.watch(dir, {recursive: true})` (FSEvents), either way | 0 ms | 56 MB | 12-13 ms |

**Per platform:**

- **macOS:** FSEvents watches a whole tree with one stream, so `@parcel/watcher` or `fs.watch` recursive is effectively free. chokidar (v4+ dropped its bundled `fsevents`) walks and watches every directory itself, per its README.
- **Linux:** everything uses inotify, which needs one watch per directory. This includes Node's `fs.watch` recursive (added for Linux in v19.1.0), `@parcel/watcher`, and chokidar. The per-user limit (`fs.inotify.max_user_watches`, "typically 8192" according to git's `fsmonitor--daemon` docs) can be exhausted by `node_modules` trees, and the chokidar README tells users to raise it. So ignored folders must be excluded from the watch **(not measured on Linux)**.
- **Windows:** `ReadDirectoryChangesW` watches a tree natively, which Node and `@parcel/watcher` use **(not measured)**.
- **Network drives and VMs:** Node documents that watching "can be unreliable, and in some cases impossible, on network file systems … or … Docker". This is one more reason not to rely on a watcher for correctness.
- **If the watcher misses events:** `@parcel/watcher` also has `writeSnapshot` / `getEventsSince`, for "what changed while the app was closed". But the git snapshot at the next Turn already answers that.

## 7. Token cost: Workspace Tree vs plain Tree

**Claude.** Script: `/tmp/uz-ws/claude/test3-tokens.mjs`, Haiku 4.5, prompt "Reply with the single word: hi". Total = input + cache write + cache read.

| Setup | Cold-Turn prompt tokens |
|---|---|
| `tools: []`, custom or no system prompt (**plain Tree**) | **378-384** |
| `tools: []`, `claude_code` preset | 6,543 |
| Read/Write/Edit/Glob/Grep, custom or no system prompt (**Workspace Tree, shell off**) | **3,739-3,745** |
| Same, `claude_code` preset | 9,904 |
| Default full toolset, no preset | 14,571 |
| Full toolset + `claude_code` preset (roughly "Claude Code") | 20,933 |
| Workspace tools **with claude.ai connectors on (the default)** | **33,466** |

- **Most of #7's "about 36k" was account connectors** (about 30k) plus the preset. It was not the Workspace itself.
- The 5 file tools add about 3.4k tokens. The full toolset adds about 14k. The preset adds about 6k.
- Changing the toolset between resumes of one session broke the cache: 31k tokens were re-written. **So a Tree's toolset should be fixed while it runs**, with shell toggled deliberately.
- These numbers were measured on Haiku; other Claude models tokenise tool definitions similarly **(unverified)**.
- Tiny prompts showed no cache writes, probably because they are below the minimum cacheable length **(inferred)**.

**Codex.** Scripts: `/tmp/uz-ws/codexq/test3*.mjs`, `gpt-5.6-luna`, "Reply with exactly: ok". Input tokens of a first Turn (about 10k of the default is served from a cross-session cache):

| Setup | Input tokens |
|---|---|
| Default | 12,713 (`gpt-5.6-sol`: 14,636) |
| `shell_tool` off | 12,463 (shell itself is only about 250) |
| `web_search` disabled | 10,647 |
| Shell, `view_image`, apps and web search off | 8,511 |
| All features off + `environments: []` + short `baseInstructions` + permission/app instructions off | about 2,237 |

- **Codex has no single "no tools" switch.** Most of the weight is the base instructions (about 3.5k), web search (about 2k) and apps/plugins (about 1-1.5k), not the file or shell tools.
- **So on Codex, a Workspace Tree costs about the same as a plain Tree.** The difference is `apply_patch` + environment context, a few hundred tokens **(not isolated exactly)**.

## Open questions this raises

- **Linked-folder model (A, B or C above):** the product decision for the #24 grilling.
- **Toolset changes mid-Tree:** should turning shell on or off be allowed mid-Tree, given that it busts the Claude cache (about 31k re-written in the test)? Or should it apply only to new Branches?
- **Fork cache cost:** a fork into a new folder is a cold Turn on both providers (Codex measured, Claude inferred). This should be shown in the UI like #7's cold-cache warning.
- **Codex fork lineage:** forks reference their parent rollout. Pruning old Threads must not delete a parent that forks still need (unverified behaviour).
- **Connector policy:** Claude account connectors are on by default in the SDK and cost about 30k tokens. Plain and Workspace Trees should turn them off, unless a later feature wants them.
- **Windows:** the Codex sandbox has to be enabled for in-Workspace auto-approval. Snapshot and checkout speed on NTFS was not measured.

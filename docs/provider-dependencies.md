# Provider dependencies

The places where the app relies on what a vendor program (`claude`, Codex's app-server), the Agent SDK or a Model happens to do, where an upgrade could change it without a type or a test noticing. The list started from the audit in [#203](https://github.com/qodesmith/unimatrix-zero/issues/203#issuecomment-6781652892).

An entry goes stale from either side:

- **Provider side:** a vendor upgrade, or the vendor's servers, changes the behavior. A dependency breaks, or a workaround is no longer needed.
- **App side:** the app removes the workaround or stops relying on the behavior, so the entry no longer describes anything.

## Adding, changing or removing an entry

A change that adds a Provider dependency or workaround adds its entry here, with a live check or a reason, in the same PR. A change that removes one removes its entry and its check. `bun run lint` fails when an entry has neither a check nor a reason, or when a test names an id that isn't here.

Entries describe behavior, never line numbers: the most specific pointer is a module name (`claude-driver`, `turns`).

| Field          | What it holds                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Id             | A stable kebab-case name that links the entry to its check                                             |
| Kind           | D (an upgrade could quietly break it), W (an upgrade could make it unnecessary), or D/W                |
| Provider       | Claude, ChatGPT or both                                                                                |
| Relies on      | The Provider's behavior, in the Provider's terms                                                       |
| App side       | What the app does that depends on it, by concept, naming a module at most                              |
| User would see | What breaks if the behavior changes                                                                    |
| Changed by     | `upgrade`, or `upgrade + drift` when the vendor's servers or the Model can change it without a release |
| Check          | `` `[dep:<id>]` `` and where its live check is, or `none: <reason>`                                    |

A live check is a test whose name carries `[dep:<id>]` (one test can carry several), in a `*.live.test.ts` that runs a real, signed-in vendor program. For a W entry, the check asserts the Provider still shows the problem the workaround exists for, so it fails once the workaround is no longer needed. `none: <reason>` is for a check that isn't possible or isn't cheap.

## Checking the list: `bun run provider-checks`

Live checks need the maintainer's signed-in account, so they never run in CI. They use the checkout's own dev data: run `bun run dev` in the checkout to be checked and connect Claude and ChatGPT, so it holds the pinned builds and both sign-ins. Then, on the maintainer's machine, `bun run provider-checks`:

1. Runs every `[dep:]` live check.
2. Has an agent on the maintainer's own `claude` login read each entry against the current code and the pinned builds, and report the ones that no longer hold on either side.
3. Posts both results in one comment on the open bump PR, tied to its head commit, and re-runs that PR's gate. With more than one bump PR open, pass `--pr <n>`. With none open, or when the checkout isn't a clean copy of the bump PR's head, it prints the results, posts nothing and says why.

A bump PR is any PR that moves a vendor pin: a version in `app/main/src/modules/vendor-programs/dev-manifest.json`, or the Agent SDK version in `app/provider-host/package.json`. CI's "Provider checks on a vendor bump" job keeps it red until the repo owner's result for its current head commit reports passing checks and no stale entries. Every other PR passes that job.

Entries the vendor's servers can change (`upgrade + drift`) are checked only when the run happens; run it by hand at any time to catch drift between releases.

## Entries

### Cut-short Replies

- **Id:** `cut-short-replies`
- **Kind:** D
- **Provider:** both
- **Relies on:** when a Reply is cut short, the vendor program writes its own note into the session, and the AI reads it on the next message. Claude adds a user entry `[Request interrupted by user]` after a Stop, and an assistant entry `No response requested.` under the Model name `<synthetic>` when it resumes after being quit or killed. Codex writes a `<turn_aborted>` message when it's quit gracefully, and nothing when it's killed. None of this is documented.
- **App side:** a stopped or interrupted Reply can be continued (`turns`), and the next Prompt goes on in the same session, resumed from the app's own copy (`claude-driver`, `codex-driver`). The app writes nothing of its own about the cut, so these notes are all the AI learns about it.
- **User would see:** on the next message the AI carries out the cut-short Prompt again, or remembers more or less than the Thread shows.
- **Changed by:** upgrade + drift. The program writes the notes, and the Model decides how to read them.
- **Check:** `[dep:cut-short-replies]` in `claude-driver`, for Claude's Stop note. Claude's note after a quit, and every Codex note, have no check yet: each needs a live Reply killed mid-stream and resumed.

### Codex's thread databases

- **Id:** `codex-history-databases`
- **Kind:** D
- **Provider:** ChatGPT
- **Relies on:** Codex resumes a thread from the rollout file under `CODEX_HOME`, even though it also keeps the thread's history in its own databases (`thread_history_1.sqlite`, `state_5.sqlite`). A rollout written over with an earlier copy wins over what the databases saw.
- **App side:** `codex-driver` saves only the rollout files Codex names, and rewinds an unloaded thread by writing the app's copy over its rollout before resuming it. Nothing in the app reads or writes the databases.
- **User would see:** after a Retry or a deletion, the AI still remembers the failed or deleted Turns.
- **Changed by:** upgrade
- **Check:** `[dep:codex-history-databases]` in `codex-driver`: a Retry's rewind on a home whose databases saw the failed Prompt.

### Sessions across versions

- **Id:** `sessions-across-versions`
- **Kind:** D
- **Provider:** both
- **Relies on:** a newer `claude` resumes session entries an older pinned `claude` wrote, and a newer Codex resumes rollouts, and opens databases, an older pinned Codex left. Neither vendor promises either.
- **App side:** the app keeps each Provider session as opaque data written by whichever pinned version ran it (`sessions`, `session-store`), and resumes every old Tree with the program pinned now. Nothing converts the data or checks its version.
- **User would see:** the next Reply in an old Tree fails with the vendor's text, or worse, the new program reads only part of the session and the AI goes on having forgotten earlier Turns. Retries and deletions miss their targets if old entry ids aren't kept.
- **Changed by:** upgrade
- **Check:** none: needs a session committed from each shipped pin, captured on a live run, to resume on the new build. None is captured yet.

### Made-up messages marked by the Model name

- **Id:** `synthetic-model-name`
- **Kind:** W
- **Provider:** Claude
- **Relies on:** `claude` gives the messages it makes up itself (error text, `No response requested.`) the Model name `<synthetic>`, a string the SDK types don't name. The SDK's assistant message has no `isSynthetic` flag; that flag exists only on user messages.
- **App side:** `claude-driver`'s Reply mapper drops any assistant message whose Model is `<synthetic>`: it never streams that text, records the Reply at it, or takes its Model.
- **User would see:** made-up error text streamed as Reply text, and the Reply recorded at a made-up message with the wrong Model.
- **Changed by:** upgrade
- **Check:** `[dep:synthetic-model-name]` in `claude-driver`: a Reply on a Model that doesn't exist gets a `<synthetic>` message with no `isSynthetic`.

### A Stop read from `terminal_reason`

- **Id:** `stop-terminal-reason`
- **Kind:** W
- **Provider:** Claude
- **Relies on:** the result of a stopped turn has `terminal_reason` `aborted_streaming` or `aborted_tools`, while it's otherwise marked as a failure: `subtype: 'error_during_execution'`, `is_error: true`, and an `[ede_diagnostic]` entry in `errors`.
- **App side:** `claude-driver` calls a Reply stopped by `terminal_reason` alone, before it looks at `subtype` or `is_error`, and ignores the `[ede_diagnostic]` text.
- **User would see:** if `terminal_reason` changed, a stopped Reply shown as failed, with `[ede_diagnostic] …` as its failure text.
- **Changed by:** upgrade
- **Check:** `[dep:stop-terminal-reason]` in `claude-driver`: a stopped Reply's result is `aborted_streaming` and still `is_error`.

### The order of streamed events

- **Id:** `stream-event-order`
- **Kind:** D/W
- **Provider:** Claude
- **Relies on:** an undocumented order: the complete `assistant` message for a text block arrives after its deltas and before its `content_block_stop`, and a second `message_start` with no `message_stop` between means the message is being sent again in full after a broken stream.
- **App side:** `claude-driver`'s Reply mapper replaces an open block's streamed text with the full text of the `assistant` message, and on a second `message_start` resets the text shown to where that message began.
- **User would see:** doubled Reply text if the order changed. If a broken stream carried on instead of starting over, the Reply would lose the text from before the break.
- **Changed by:** upgrade + drift. The stream events come from the API, and how a broken stream recovers is up to `claude` and the servers.
- **Check:** `[dep:stream-event-order]` in `claude-driver`: a Reply's text is shown once. A stream sent again after a break has no check: it needs a stream cut mid-message.

### The Prompt stored under the app's id

- **Id:** `prompt-stored-under-app-uuid`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** `claude` saves a Prompt's user entry under the `uuid` the client sends on `SDKUserMessage`, a field with no doc comment.
- **App side:** main picks the Prompt's id and `claude-driver` sends the Prompt under it. `turns` records the Prompt once main's copy of the session holds an entry with that id, and a Retry's cut and deleting Turns cut there.
- **User would see:** Prompts never recorded, so a Retry after a Reply cut short, or a deletion, keeps or drops the wrong Turns.
- **Changed by:** upgrade
- **Check:** `[dep:prompt-stored-under-app-uuid]` in `claude-driver`: the app's copy holds a user entry under the Prompt's id.

### Prompts delivered as written

- **Id:** `verbatim-prompts`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** `claude` honors the SDK's `verbatimPrompts` option, which sends each user message marked `client_composed`: `claude` delivers its text as written, with no slash-command dispatch and no `@path` file-mention expansion. Without the mark, a Prompt such as `/compact` is run as a command, and its turn ends with no assistant message. The mark also skips the turn-start attachment pass: nested `CLAUDE.md` and rules files, skill and tool listings, and per-turn reminders arrive only after the turn's first tool call. With no settings and no tools, that pass held nothing over two warm turns on one day; what it holds on a cold resume, or after a date change between turns, is unchecked.
- **App side:** `claude-driver` turns the option on for every Reply and every one-shot, so each Prompt reaches the AI as text, and each Reply ends at a message the app can record. With no tools, a turn makes no tool call, so nothing the pass skips arrives later.
- **User would see:** a Prompt such as `/compact` run instead of answered: a Reply with no text, marked complete, whose Input says it can't be continued. An `@path` in a Prompt would show the AI that file.
- **Changed by:** upgrade
- **Check:** `[dep:verbatim-prompts]` in `claude-driver`: `/compact` sent as a Prompt gets an answer and no Compaction, and the next Prompt goes on from it. `@path`, and one-shots, have no check.

### A refused resume sends no `init`

- **Id:** `refused-resume-no-init`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** when `claude` refuses a resume ("No conversation found with session ID: …"), it never sends `system/init`, and on every turn it does run it sends `init` before any content.
- **App side:** `claude-driver` takes the session id from `init`, and treats a resume from the app's copy that ends before `init` as refused: it writes the transcript back to disk and starts `claude` again. Any failure before `init`, such as being offline, takes the same path.
- **User would see:** if `claude` sent `init` before refusing, the fallback would never run and a Thread that could go on would fail.
- **Changed by:** upgrade
- **Check:** `[dep:refused-resume-no-init]` in `claude-driver`: a resume of an unknown session ends with that refusal and no `init`.

### The project folder's name

- **Id:** `project-key-copy`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** the private function the SDK and `claude` name a session's project folder with: every non-alphanumeric character becomes `-`, and past 200 characters the name is cut and a hash of the path added. Session files live at `projects/<key>/<session>.jsonl`, beside a `tool-results/` folder.
- **App side:** `claude-driver` computes the key with its own copy of that function, and uses it as the session store's key, to put tool results back on disk, and to write the transcript back on a refused resume.
- **User would see:** tool results lost on resume, and a transcript written back where `claude` doesn't look, so resumes fail.
- **Changed by:** upgrade
- **Check:** `[dep:project-key-copy]` in `claude-driver`: `claude` writes the session under the key the app computes, and the app's copy holds it under the same key. A path long enough to be hashed has no check.

### Resuming through a swapped config folder

- **Id:** `resume-config-swap-keychain`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** SDK internals: on a resume from the app's copy, the SDK copies the session into a temporary `claude-resume-*` folder and points `CLAUDE_CONFIG_DIR` at it, and on a Mac `claude` finds its sign-in through a Keychain name, `Claude Code-credentials-` plus the first 8 hex of the SHA-256 of `CLAUDE_SECURESTORAGE_CONFIG_DIR`, or of `CLAUDE_CONFIG_DIR` when that's unset.
- **App side:** `claude-driver`'s environment sets `CLAUDE_SECURESTORAGE_CONFIG_DIR` to the real config folder so the sign-in stays findable, and reads the swapped `CLAUDE_CONFIG_DIR` to put tool results back. `bun run dev-data:prune` computes that name to find a removed worktree's Claude sign-in.
- **User would see:** Replies resumed from the app's copy fail signed out, or lose their tool results. The maintainer would see `dev-data:prune` leave removed worktrees' sign-ins behind, listed as unmatched.
- **Changed by:** upgrade
- **Check:** `[dep:resume-config-swap-keychain]` in `claude-driver`: a Reply resumed from the app's copy alone, with the transcript gone, completes signed in. The Keychain name's hash has no check: a change shows as `dev-data:prune` listing every dev sign-in as unmatched.

### The SDK's alpha session store

- **Id:** `sdk-session-store-alpha`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** the SDK's `@alpha` `SessionStore` contract: `append`, `load` and `listSubkeys` keyed by project, session and subpath; `uuid` as the key for skipping duplicates; a refused append retried, then dropped with a `system`/`mirror_error` message; and `load` run once before `claude` starts.
- **App side:** `session-store` and `claude-driver` keep main's copy of the session through this store, main skips duplicates by `uuid`, and a `mirror_error` leaves the Reply unrecorded.
- **User would see:** entries missing from the app's copy with no sign, or a Reply recorded at an entry the copy doesn't hold, so resumes lose Turns or fail.
- **Changed by:** upgrade
- **Check:** `[dep:sdk-session-store-alpha]` in `claude-driver`: when the app's copy refuses every entry, the Reply completes unrecorded.

### The plan read from `subscriptionType`

- **Id:** `plan-from-subscription-type`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** `accountInfo().subscriptionType` is a free-form string that names a paid plan `Claude <name>` (for example `Claude Max`), and no plan `Claude API`.
- **App side:** `claude-driver`'s sign-in reads the plan from that string, and signs out and refuses an account with none.
- **User would see:** paying users signed out with "This Claude account has no Pro or Max plan."
- **Changed by:** upgrade + drift. The plan names come from the servers.
- **Check:** `[dep:plan-from-subscription-type]` in `claude-driver`: the maintainer's account reads as having a plan. Other plans' names have no check.

### Sign-in through `claude auth login`

- **Id:** `claude-auth-login-output`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** the output of `claude auth login --claudeai` with no terminal: a link on stdout whose URL carries `state`, a pasted code shaped `<code>#<state>` read on stdin, exit 1 for a wrong code with `#`, and exit 0 once signed in.
- **App side:** `claude-driver`'s sign-in reads the link from that output, sends only codes that end in `#<state>`, and decides the outcome by the exit code.
- **User would see:** a sign-in that hangs until "Claude's page did not answer", or every pasted code called wrong.
- **Changed by:** upgrade + drift. The code's shape comes from the sign-in page on the servers.
- **Check:** none: running it opens a browser tab, and a successful sign-in needs a person.

### `claude` exits by itself

- **Id:** `claude-exits-on-input-end`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** `claude` exits by itself soon after its input ends, saving a refreshed token on the way out, while the SDK would kill it about 2 seconds after closing.
- **App side:** `claude-driver` closes its sessions, one-shots and account reads by ending input and waiting for `claude` to exit, and closes through the SDK only after a timeout.
- **User would see:** a lost token refresh and a later sign-out, or every close taking the full timeout.
- **Changed by:** upgrade
- **Check:** `[dep:claude-exits-on-input-end]` in `claude-driver`: an account read's `claude` exits by itself, not killed. Whether a refreshed token gets saved has no check.

### Self-updates turned off

- **Id:** `self-updates-off`
- **Kind:** D
- **Provider:** both
- **Relies on:** `claude` honors `DISABLE_UPDATES`, a variable named only in the binary, not in the SDK types. Codex honors `check_for_update_on_startup=false`.
- **App side:** each driver's environment sets the switch. `vendor-program` re-hashes `claude` on every check, so a self-updated `claude` is downloaded again; for Codex it checks only the entrypoint and its note.
- **User would see:** a vendor program that updates itself off the pin: `claude` downloaded again every time, and a Codex update that goes unnoticed.
- **Changed by:** upgrade
- **Check:** `[dep:self-updates-off]` in `claude-driver` and `codex-driver`: each pinned program still holds the name of every switch its driver sets, this one included, so it also catches a renamed `cli_auth_credentials_store`. Whether it's honored has no check: testing it could update the program.

### A cut with no target resumes at the newest entry

- **Id:** `cut-with-no-target-resumes-at-newest`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** a resume with no `resumeSessionAt` loads the session up to its newest entry, a failed attempt's Prompt and error entry included. `claude` can drop entries only by resuming at an earlier one.
- **App side:** `claude-driver` turns a cut that names nothing to keep into a plain resume, which is why `turns` always names what a Retry's cut keeps (#214).
- **User would see:** if a Retry's cut named nothing to keep, the AI would still see the failed attempt and might carry it out again.
- **Changed by:** upgrade
- **Check:** `[dep:cut-with-no-target-resumes-at-newest]` in `claude-driver`: after a failed attempt, a cut naming nothing still shows the AI the failed Prompt.

### No fallback Model after a refusal

- **Id:** `no-refusal-fallback`
- **Kind:** D
- **Provider:** Claude
- **Relies on:** a refused Reply is never retried on a fallback Model. The SDK documents that it can be, keeping the swap for the session and withdrawing the refused text through `retracted_message_uuids` and `supersedes`, and the servers gate some cases.
- **App side:** `claude-driver`'s Reply mapper ignores `model_refusal_fallback` and `supersedes`, and records the Model of the last message.
- **User would see:** the refused text kept with the fallback's text after it, and the Reply recorded on the fallback Model.
- **Changed by:** upgrade + drift. The servers decide whether a fallback runs, and the Model decides when it refuses.
- **Check:** none: needs a Reply the Model refuses, which can't be caused on purpose, and the servers decide whether a fallback runs.

### Codex's rollout files

- **Id:** `codex-rollout-files`
- **Kind:** D
- **Provider:** ChatGPT
- **Relies on:** `thread/read` names each thread's rollout file (`Thread.path`, marked `[UNSTABLE]`) and its fork parent, inside `CODEX_HOME` under `sessions/`. Codex only appends to a rollout it resumes, writes a compressed `.jsonl.zst` it resumes back out as plain `.jsonl`, and resumes a thread by id from files written back under their original names.
- **App side:** after each Reply, `codex-driver` saves the files Codex names, following fork parents. Before a resume or fork it writes them back, leaving alone a file on disk that starts with the saved bytes, so a Reply cut short stays in the thread.
- **User would see:** a moved or renamed rollout isn't saved and nothing says so; the next cold resume fails with "no rollout found for thread id". A rollout rewritten in place fails the prefix test, so the app's copy overwrites it and loses a Reply cut short.
- **Changed by:** upgrade
- **Check:** `[dep:codex-rollout-files]` in `codex-driver`: one rollout under `sessions/`, appended to, then resumed from the app's copy. The `.zst` rewrite has no check: Codex compresses in background upkeep a test can't start.

### Codex's thread revert

- **Id:** `codex-thread-revert`
- **Kind:** D
- **Provider:** ChatGPT
- **Relies on:** `thread/revert` writes a new rollout that refers back into the old one and leaves the old file untouched. Once a turn is reverted, `thread/turns/list` no longer lists it, so an error from reverting a turn that list lacks means it's already gone.
- **App side:** for a Retry's rewind or a deletion's cut, `codex-driver` reverts, saves the old rollout beside the new one, and treats a refused revert of an unlisted turn as done.
- **User would see:** resumes from the app's copy fail, or deleted Turns come back into what the AI remembers. If reverted turns stayed listed, every Retry after a failed attempt would fail.
- **Changed by:** upgrade
- **Check:** `[dep:codex-thread-revert]` in `codex-driver`: a rewind of a loaded thread, and a cut of an unloaded one resumed from the app's copy.

### Codex starts a message over after a reconnect

- **Id:** `codex-reconnect-new-message`
- **Kind:** W
- **Provider:** ChatGPT
- **Relies on:** when Codex's connection drops mid-Reply, it streams the answer again as a new `agentMessage` item and never finishes the old one, at times without any notification that it retried.
- **App side:** the Reply mapper in `codex-driver` drops a message that never finished as soon as a new one starts, replacing the text shown so far (#213).
- **User would see:** nothing while Codex keeps doing this. If Codex starts finishing or resuming the old item, the workaround is no longer needed; if it starts a real follow-on message while the first is unfinished, the app drops text that should stay.
- **Changed by:** upgrade + drift. The new item's id comes from OpenAI's response, so a server that resumed a dropped stream would end the problem without a Codex release.
- **Check:** `[dep:codex-reconnect-new-message]` in `codex-driver`: a Reply whose connection is cut, asserting Codex still leaves the first item unfinished and finishes a second.

### Codex is sent a Prompt again after an app-server dies

- **Id:** `codex-resend-unanswered-prompt`
- **Kind:** D
- **Provider:** ChatGPT
- **Relies on:** an app-server that exits before answering `turn/start` (or the `thread/start` or `thread/resume` before it) hasn't saved the Prompt to the rollout.
- **App side:** when nothing was heard back and the app-server has exited, `codex-driver` tries once more on a new app-server, loading the thread from the app's copy.
- **User would see:** the Prompt twice in the thread, so the AI sees it twice.
- **Changed by:** upgrade
- **Check:** none: needs Codex killed between reading `turn/start` and answering it, a window a test can't hit on purpose.

### Codex sends no server requests

- **Id:** `codex-server-requests-refused`
- **Kind:** D
- **Provider:** ChatGPT
- **Relies on:** with `approvalPolicy: 'never'`, a read-only sandbox and no client capabilities, Codex sends none of its server requests (approvals, user input, tool calls, token refreshes) during a Reply.
- **App side:** the app-server client in `codex-driver` refuses every server request at once.
- **User would see:** a Reply that stalls or fails in Codex's wording, for example when an upgrade adds a request type or a connector asks the user for input.
- **Changed by:** upgrade + drift. An upgrade can add request types, the Model picks the tools it calls, and OpenAI's servers supply the connectors.
- **Check:** `[dep:codex-server-requests-refused]` in `codex-driver`: a Reply that runs a shell command, with no server request on the wire.

### Codex's protocol types

- **Id:** `codex-protocol-types`
- **Kind:** D
- **Provider:** ChatGPT
- **Relies on:** Codex keeps the method names and shapes of the notifications and answers the app reads, as `codex app-server generate-ts` produced them for the pinned version.
- **App side:** `codex-driver` parses notifications against a closed list and drops anything else or anything that fails to parse. Its schemas match the committed types in `protocol/`, so only a regenerated `protocol/` turns a changed shape into a typecheck error, and `bun run codex-protocol` isn't run when the pin moves.
- **User would see:** a Reply that streams until Codex exits, text that appears all at once at the end, or wrong token counts and missing limit-reset times.
- **Changed by:** upgrade
- **Check:** `[dep:codex-protocol-types]` in `codex-driver`: the types the pinned Codex generates match `protocol/`. #114 will regenerate them on each bump; when it lands, it updates this entry.

### Codex's sign-in port and refusal wording

- **Id:** `codex-sign-in-port-and-refusal`
- **Kind:** D
- **Provider:** ChatGPT
- **Relies on:** `account/login/start` runs Codex's local callback server on port 1455, and a second sign-in started while one holds it cancels the first. When OpenAI's page answers `missing_codex_entitlement`, `account/login/completed` carries the English error "Codex is not enabled for your workspace".
- **App side:** `codex-driver` reports "Another ChatGPT or Codex sign-in is open" when port 1455 is taken, and marks a sign-in plan-refused only when the error holds that phrase.
- **User would see:** a false "another sign-in is open", or a sign-in elsewhere silently canceled. A refused workspace shown as a page that never answered instead of the plan-refused explanation.
- **Changed by:** upgrade + drift. The port and the wording ship in the program; the `missing_codex_entitlement` answer comes from OpenAI's servers.
- **Check:** `[dep:codex-sign-in-port-and-refusal]` in `codex-driver`: the pinned program holds the phrase, and a sign-in takes the port. It cancels any Codex sign-in open on the machine at the time.

### Failures sorted by their wording

- **Id:** `failures-by-wording`
- **Kind:** W
- **Provider:** both
- **Relies on:** the vendors' English failure text. Needs-app-update matches `requires a newer version of (Codex|Claude Code)`: Codex's wording is OpenAI's real server text, Claude's was made up. Connection-lost and limit-reached match lists of words and error codes.
- **App side:** `failures` sorts every failure but too-long by regex; too-long reads typed fields since #224. On needs-app-update, main marks the Model unusable for good.
- **User would see:** if the wording changes, the vendor's raw text instead of "Connection lost" or "Limit reached · resets at…", with the reported reset time dropped. A Model the program is too old for stays pickable, or an unrelated message holding the phrase disables a Model for good.
- **Changed by:** upgrade + drift. `claude` writes its own limit lines; limit and version text from the servers can change at any time.
- **Check:** none: the pinned builds already send typed codes for limit-reached and connection-lost, so a check that the problem remains would fail today; moving those onto the codes is app work, tracked in #237. Needs-app-update has no typed code and can't be caused on demand.

### Claude's Compaction settings

- **Id:** `claude-compaction-settings`
- **Kind:** D/W
- **Provider:** Claude
- **Relies on:** `claude` takes `autoCompactWindow` and `autoCompactEnabled` in the SDK's `settings`. It compacts on its own at the window minus 13,000, and minus up to 20,000 more for output, and never past the Model's own limit. It takes only integers from 100,000 to 1,000,000 and drops any other value without an error. `autoCompactEnabled: false` stops automatic Compaction past any threshold. `claude` fixes the window as it starts: `applyFlagSettings` stores a new one and doesn't apply it, though it does apply `autoCompactEnabled`.
- **App side:** `claude-driver` starts `claude` with the Compaction Settings, and with neither key for a default. It closes a warm `claude` started with other Compaction Settings, so the next Reply resumes the session in a new one. The Setting's range is the one `claude` takes.
- **User would see:** a threshold that changes nothing, or a Thread that compacts with Compaction off. If `claude` narrowed the range, values outside it would be ignored without a word.
- **Changed by:** upgrade
- **Check:** `[dep:claude-compaction-settings]` in `claude-driver`: a Thread under a lowered threshold doesn't compact, past it with Compaction off doesn't, and with Compaction on again it does, each from the next Reply. Whether `applyFlagSettings` still ignores a new window, which would make closing the warm `claude` unnecessary, has no check.

### Codex's Compaction limit

- **Id:** `codex-compaction-limit`
- **Kind:** D
- **Provider:** ChatGPT
- **Relies on:** Codex takes `model_auto_compact_token_limit`, an integer, in `config` on `thread/start`, `thread/resume` and `thread/fork`, and accepts a misspelled key without an error. It checks the limit as a turn starts, and clamps it to 90% of the Model's raw Context window. On `thread/resume` it ignores `config` for a thread that a client is subscribed to, and takes it after `thread/unsubscribe`. A resume that brings no `config` keeps the old limit.
- **App side:** `codex-driver` sends the threshold in `config` on every thread it starts, resumes or forks, and for the default sends no `config` on a start and an empty one on a resume or fork. When the threshold for a loaded thread changes, it unsubscribes and resumes the thread.
- **User would see:** a threshold that changes nothing, or that reaches a Thread only once the app-server restarts.
- **Changed by:** upgrade
- **Check:** `[dep:codex-compaction-limit]` in `codex-driver`: a thread under the threshold doesn't compact, and compacts on the next Reply once the threshold drops below its size while it's loaded. The clamp has no check: a full Context window costs about 450,000 tokens.

### The largest Codex Context window

- **Id:** `codex-largest-context-window`
- **Kind:** D
- **Provider:** ChatGPT
- **Relies on:** the largest raw Context window among Codex's Models is 500,000 tokens (`gpt-6.1-sol` and `gpt-6.1-terra`; Codex reports 95% of it as `modelContextWindow`). Codex fetches its Model catalog from OpenAI's servers, so the list can change without a release.
- **App side:** the top of ChatGPT's Compaction threshold Setting is 450,000, 90% of that window, and stands for Codex's default.
- **User would see:** with a larger Model, a slider that can't reach that Model's own default; with a smaller largest Model, a top stretch of the slider that acts as the default.
- **Changed by:** upgrade + drift
- **Check:** none: a Model's raw window shows only in Codex's catalog cache, and a check would take a Reply on every Model.

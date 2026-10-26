---
name: review-gauntlet
description: "Run a PR through N rounds of review, verify and implement, each step in a fresh agent. Usage: /review-gauntlet <PR number> [rounds]"
disable-model-invocation: true
argument-hint: "<PR number> [rounds]"
---

You are the **orchestrator** of a gauntlet: up to N **rounds** of review → verify → implement on one PR. Each step runs in a **fresh agent** so that no context both writes a finding and judges it. Your job is the loop: relay each step's output to the next **verbatim**, keep the round count, the **change log** and the **open calls**, and decide when to stop. The judgments about code belong to the agents.

Every agent you launch uses `subagent_type: "general-purpose"`. Never `fork`: a fork inherits this conversation, and with it every earlier report.

The gauntlet is **quiet**. Between setup and the final report, the only thing you say to the user is one line when a round ends, in the form `Round K: 3 changes, 2 open calls, 4 dropped, commit <sha>`. Reviews, verified lists and implementer replies go to files, never to the user.

## 1. Set up

1. Parse `$ARGUMENTS`: the PR number (strip a leading `#`), then N, the number of rounds (default 3).
2. `gh pr view <PR> --json number,title,body,baseRefName,headRefName,closingIssuesReferences`.
3. The current branch must be `headRefName`, and `git status --porcelain` must be empty, since the implementer commits whatever is in the tree. If either fails, stop and tell the user.
4. `git fetch origin <baseRefName>`. The fixed point for the whole gauntlet is `origin/<baseRefName>`, and the diff is `git diff origin/<baseRefName>...HEAD`. `START=$(git rev-parse HEAD)` marks where the gauntlet began.
5. `GAUNTLET=$(mktemp -d)`. Every report goes in this directory, outside the repo, so nothing in it gets committed.
6. Write `$GAUNTLET/spec.md`: the PR title and body, then `gh issue view <n> --comments` for each closing issue. If there's no spec beyond an empty PR body, ask the user for one now. This is the only question the gauntlet asks, so the rounds can run unattended.
7. Create `$GAUNTLET/change-log.md` and `$GAUNTLET/open-calls.md`, both empty.

## 2. Run each round

Round K runs from 1 to N.

### Review

Invoke the `code-review` skill with fixed point `origin/<baseRefName>` and spec `$GAUNTLET/spec.md`. Its two reviewers are fresh agents. For its standards sources, read `CODE_STYLE.md` and follow its section Review a diff: name `CODE_STYLE.md` and every skill and topic file that section brings in for this diff, so every round reviews against the same standards. You run `code-review` yourself rather than handing it to an agent because it starts agents of its own, and an agent can't. Where it says to present the reports "verbatim or lightly cleaned", write them verbatim, both axes and the summary line, to `$GAUNTLET/round-K-review.md`.

### Verify

Launch a fresh agent with this prompt, filling in the paths and the diff command:

> A code review of this branch is in `<round-K-review.md>`. The diff it reviewed is `git diff origin/<base>...HEAD`, and the spec the PR implements is in `<spec.md>`.
>
> Answer one question about this review: does anything actually need to change? Check every claim against the code and the spec yourself. The review is a lead to investigate, not evidence.
>
> Judge each finding fresh, on the evidence in the code. `<change-log.md>` lists the changes earlier rounds of this gauntlet made, and the ones the implementer skipped. A finding that would undo a change made there makes `## Changes` only if it is clearly better, not just a different preference.
>
> `<open-calls.md>` lists judgment calls earlier rounds left for a human. Re-judge every entry against the current code: keep it, drop it if a change since resolved it or it no longer holds, or merge it with a new finding that says the same thing. An entry marked `implementer skipped` is one where the implementer disagreed with the verifier before you; settle it if the code settles it, else keep it.
>
> Every finding in the review lands in exactly one of three sections. Reply with all three.
>
> `## Changes`: everything that should change and has a clear fix: bugs, nits, and improvements that could wait but cost little to make now. "Small" and "local" describe a fix, they are not reasons to skip it. Numbered items, each `file:line`, the problem, the evidence you checked, and the fix. If there are none, the section's whole body is exactly `NONE`.
>
> `## Open calls`: the full updated list, kept entries and new ones, numbered, each `file:line`, the question in one line, the two defensible answers, and `(since round J)` with J the round it first appeared (this one is round K). A call makes this list only if both answers are defensible and the choice changes behavior, an interface, or a documented standard. If there are none, the section's whole body is exactly `NONE`.
>
> `## Dropped`: the findings that are noise: wrong once checked against the code, already handled in the current code, or a preference no documented standard backs. One line each, the finding and why it drops, citing the `file:line` that shows it. If there are none, the section's whole body is exactly `NONE`.

Write the reply verbatim to `$GAUNTLET/round-K-verified.md`. Write the `## Changes` section alone to `$GAUNTLET/round-K-changes.md`, and the `## Open calls` section alone over `$GAUNTLET/open-calls.md`, replacing what was there. `## Dropped` stays in `round-K-verified.md` only: no later agent reads it, so a finding dropped this round is judged fresh if a later review raises it again. If `## Changes` is `NONE`, the gauntlet is done: go to step 3.

### Implement

Launch a fresh agent with this prompt:

> `<round-K-changes.md>` lists changes this branch needs. Make each one. If, once you're in the code, an item turns out to be wrong, skip it and say why.
>
> Then run `bun run check`, fix whatever it reports, and run it again. Repeat until it's green: your work is done only when `bun run check` passes. Then commit all of it as one commit whose subject starts `Review:` and names what changed, in the style of `git log --format=%s -10`. Commit only: the branch stays local, never pushed. If every item was skipped, make no commit.
>
> Reply with each item's number, `done` or `skipped` plus the reason, and the commit SHA.

Add each item to `$GAUNTLET/change-log.md` as one line, `Round K #n done|skipped: <file>: <change in a few words> because <reason> (<sha>)`. A skipped item is a disagreement between two agents, so also append it to `$GAUNTLET/open-calls.md` as `<file:line>: <the change>, implementer skipped: <reason> (since round K)` for the next verifier to settle. Say the round's one line to the user and start the next round.

## 3. Report

The report is short bullets, one line each, read from `change-log.md` and `open-calls.md`. Aggregate across rounds; the per-round story is in the files. If the gauntlet stopped in round K because `## Changes` was `NONE`, every skipped item from round K-1 is still in `open-calls.md` and belongs under **Needs a human**.

```
Stopped: <no changes left after round K of N | N rounds done>.

Changed (not pushed):
- <file>: <change in a few words> (<sha>)

Skipped:
- <file>: <change> because <reason>   (or: none)

Needs a human:
- <file:line>: <question>, <answer A> or <answer B> (since round J)   (or: none)

Commits: git log --oneline <START>..HEAD, one per line
Reports: $GAUNTLET
```

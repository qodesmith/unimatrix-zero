---
name: review-gauntlet
description: "Run a PR through N rounds of review, verify and implement, each step in a fresh agent. Usage: /review-gauntlet <PR number> [rounds]"
disable-model-invocation: true
argument-hint: "<PR number> [rounds]"
---

You are the **orchestrator** of a gauntlet: up to N **rounds** of review → verify → implement on one PR. Each step runs in a **fresh agent** so that no context both writes a finding and judges it. Your job is the loop: relay each step's output to the next **verbatim**, keep the round count and the **change log**, and decide when to stop. The judgments about code belong to the agents.

Every agent you launch uses `subagent_type: "general-purpose"`. Never `fork`: a fork inherits this conversation, and with it every earlier report.

## 1. Set up

1. Parse `$ARGUMENTS`: the PR number (strip a leading `#`), then N, the number of rounds (default 3).
2. `gh pr view <PR> --json number,title,body,baseRefName,headRefName,closingIssuesReferences`.
3. The current branch must be `headRefName`, and `git status --porcelain` must be empty, since the implementer commits whatever is in the tree. If either fails, stop and tell the user.
4. `git fetch origin <baseRefName>`. The fixed point for the whole gauntlet is `origin/<baseRefName>`, and the diff is `git diff origin/<baseRefName>...HEAD`.
5. `GAUNTLET=$(mktemp -d)`. Every report goes in this directory, outside the repo, so nothing in it gets committed.
6. Write `$GAUNTLET/spec.md`: the PR title and body, then `gh issue view <n> --comments` for each closing issue. If there's no spec beyond an empty PR body, ask the user for one now. This is the only question the gauntlet asks, so the rounds can run unattended.
7. Create `$GAUNTLET/change-log.md`, empty.

## 2. Run each round

Round K runs from 1 to N.

### Review

Invoke the `code-review` skill with fixed point `origin/<baseRefName>` and spec `$GAUNTLET/spec.md`. Its two reviewers are fresh agents. You run `code-review` yourself rather than handing it to an agent because it starts agents of its own, and an agent can't. Where it says to present the reports "verbatim or lightly cleaned", present them verbatim. Write the full report, both axes and the summary line, to `$GAUNTLET/round-K-review.md`.

### Verify

Launch a fresh agent with this prompt, filling in the paths and the diff command:

> A code review of this branch is in `<round-K-review.md>`. The diff it reviewed is `git diff origin/<base>...HEAD`, and the spec the PR implements is in `<spec.md>`.
>
> Does anything in the review actually need to change? Check every claim against the code and the spec yourself. The review is a lead to investigate, not evidence. A finding makes your list only if it's a real bug, a real improvement to the code, or something that matters in a meaningful way. Your list holds only changes that need to happen: findings that are fine as is, or that the review got wrong, stay off it.
>
> `<change-log.md>` lists what earlier rounds of this gauntlet changed or rejected, and why. A finding that would reverse one of those entries makes your list only if it is clearly better, not just a different preference.
>
> For each change, give a numbered item: `file:line`, the problem, the evidence you checked, why it matters, and the fix. If nothing needs to change, your entire reply is exactly `NOTHING NEEDS TO CHANGE`.

Write the reply verbatim to `$GAUNTLET/round-K-verified.md`. If the reply is exactly `NOTHING NEEDS TO CHANGE`, the gauntlet is done: go to step 3.

### Implement

Launch a fresh agent with this prompt:

> `<round-K-verified.md>` lists changes this branch needs. Make each one. If, once you're in the code, an item turns out to be wrong, skip it and say why.
>
> Then run `bun run check`, fix whatever it reports, and run it again. Repeat until it's green: your work is done only when `bun run check` passes. Then commit all of it as one commit whose subject starts `Review:` and names what changed, in the style of `git log --format=%s -10`. Commit only: the branch stays local, never pushed. If every item was skipped, make no commit.
>
> Reply with each item's number, `done` or `skipped` plus the reason, and the commit SHA.

Add each item to `$GAUNTLET/change-log.md` as one line, `Round K #n done|skipped: <change> because <reason>`, and start the next round.

## 3. Report

Tell the user:

- Why the gauntlet stopped: `NOTHING NEEDS TO CHANGE` in round K, or N rounds done.
- Per round, the items done and skipped, each in one line, plus the commit SHA.
- `git log --oneline origin/<base>..HEAD` for the gauntlet's commits, and that nothing was pushed.
- The `$GAUNTLET` path, where every round's review, verified list and the change log are kept.

---
name: implement-next
description: "Claim the next ticket on the frontier, implement it by following the implement skill, and open a PR that closes it."
disable-model-invocation: true
argument-hint: "An issue number to take instead of the frontier's first, or nothing"
---

Work one ticket from the **frontier**: the open `ready-for-agent` issues with no open blocker and no assignee. The tracker's native blocked-by edges are the gate and the assignee is the **lock**, so two sessions running this at once take different tickets. The issue tracker conventions are in `docs/agents/issue-tracker.md`.

## Steps

1. **Pick.** With an argument, take that issue. Otherwise take the lowest-numbered frontier ticket:

   ```sh
   gh api 'repos/{owner}/{repo}/issues?labels=ready-for-agent&state=open&per_page=100&direction=asc' \
     --jq '[.[] | select((.pull_request|not) and .assignees==[] and .issue_dependencies_summary.blocked_by==0) | .number] | first'
   ```

   An empty result means the frontier is empty: report which open tickets are blocked and which are assigned, and stop.

2. **Claim.** Run `gh issue edit <n> --add-assignee @me` - If the issue already has an assignee, it is someone else's lock: stop and say so.

3. **Branch.** Ensure that there are no changes on the current branch. If they are, guide the user towards handling that so nothing is lost. Then, from a fresh `main` (`git switch main && git pull --ff-only`), create the `<n>-<slug>` branch where the slug is the first few words of the title. Switch to the newly created branch.

4. **Implement.** Read `.agents/skills/implement/SKILL.md` and follow it with issue #<n> as the spec. Build only what the ticket's acceptance criteria name. Anything the PR adds that nothing in the same PR reads or calls is anticipating a later ticket; it belongs to the ticket that needs it, even when the PRD mentions it. A ticket asks for two things: criteria to meet and (potentially) questions to answer. Those answers, and answers to questions that come up while building, go in one comment on the issue so they outlive the session.

5. **Open the PR.** Push the branch and open the PR with the `pr` skill's template, first line `Closes #<n>`. Merging it closes the issue and unblocks the tickets behind it.

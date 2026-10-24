---
name: address-pr-comments
description: Use when the user wants to address comments on their pull request.
disable-model-invocation: true
---

## Gather the comments

If the user gave 1 or more GitHub links, address only those. Otherwise address every open comment on the PR for the current branch (`gh pr view --json number,author,headRepositoryOwner,headRepository`).

Collect all three comment surfaces. Review-level and issue-level comments are not inline, so they have no thread and never show up in the inline list.

```bash
# Inline review threads — skip resolved ones
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviewThreads(first:100){nodes{id isResolved path line comments(first:50){nodes{id body author{login} url}}}}}}}' -F o=OWNER -F r=REPO -F n=NUMBER

# Review bodies (#pullrequestreview-<id>) and PR conversation comments (#issuecomment-<id>) — skip minimized ones
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){pullRequest(number:$n){reviews(first:100){nodes{id state body isMinimized author{login} url}} comments(first:100){nodes{id body isMinimized author{login} url}}}}}' -F o=OWNER -F r=REPO -F n=NUMBER
```

Filter out, on every surface:

- Comments whose `author.login` is the PR author. Our own replies from a previous run live there and must not be re-addressed.
- Reviews with an empty `body`.
- Non-inline comments with `isMinimized: true` and inline threads with `isResolved: true`. Those were handled on a previous run.

Link shapes map to endpoints: `#discussion_r<id>` → `pulls/comments/<id>`, `#pullrequestreview-<id>` → `pulls/NUMBER/reviews/<id>`, `#issuecomment-<id>` → `issues/comments/<id>`. Each REST response carries `node_id`, which is the GraphQL `id` the mutations below need.

A review body often holds several points under headings like "must change", "minor", "nice-to-have". Treat each point as its own comment, but the review is hidden as one unit (see below).

## Decide and act

Read each comment and objectively discern whether the author has raised a concern that must result in a change to the codebase. Don't blindly accept what the comment says: double check, confirm, and analyze it in the context of what the PR set out to do.

If a comment warrants a change, briefly state why, then do the work. If the work is substantial enough to warrant multiple subagents in parallel, use them.

## Finish

Give a succinct, easy to understand summary of what you changed, and which comments you chose not to act on and why.

Then ask the user, as a single yes/no, whether to commit, push, respond to the comments, and close them out. If yes, do it all:

1. Commit and push.
2. **Inline threads.** Reply in-thread, then resolve with the `resolveReviewThread` mutation.
3. **Non-inline comments.** Post one PR conversation comment that answers each point. Then hide each original with `minimizeComment`, using `RESOLVED` when any of its points led to a change and `OUTDATED` when none did.

```bash
gh api graphql -f query='mutation($id:ID!,$c:ReportedContentClassifiers!){minimizeComment(input:{subjectId:$id,classifier:$c}){minimizedComment{isMinimized}}}' -F id=NODE_ID -F c=RESOLVED
```

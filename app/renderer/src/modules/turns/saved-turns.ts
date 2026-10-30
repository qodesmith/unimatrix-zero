import type {QueryClient} from '@tanstack/react-query'
import type {CommandResult} from '@uz/contract/commands'
import type {Reply, ReplyProgress} from '@uz/contract/turns'

export type Turns = CommandResult<'tree.turns'>

export function turnsKey(treeId: string) {
  return ['turns', treeId] as const
}

/** A saved Reply as far as its run has got. */
export function withProgress(
  reply: Reply,
  {status, content, contextSize, contextWindow, failure}: ReplyProgress
): Reply {
  return {...reply, status, content, contextSize, contextWindow, failure}
}

export function addSent(
  queryClient: QueryClient,
  treeId: string,
  {prompt, reply}: CommandResult<'prompt.send'>
) {
  queryClient.setQueryData<Turns>(turnsKey(treeId), turns => ({
    prompts: [...(turns?.prompts ?? []), prompt],
    replies: [...(turns?.replies ?? []), reply],
  }))
}

/** Leaves the Turns alone when they aren't loaded or hold no such Reply. */
export function updateSavedReply(
  queryClient: QueryClient,
  {treeId, replyId}: {treeId: string; replyId: string},
  update: (saved: Reply) => Reply
) {
  queryClient.setQueryData<Turns>(turnsKey(treeId), turns =>
    turns
      ? {
          ...turns,
          replies: turns.replies.map(saved =>
            saved.id === replyId ? update(saved) : saved
          ),
        }
      : turns
  )
}

export function removeDeleted(
  queryClient: QueryClient,
  treeId: string,
  {promptIds, replyIds}: CommandResult<'prompt.delete'>
) {
  const prompts = new Set(promptIds)
  const replies = new Set(replyIds)

  queryClient.setQueryData<Turns>(turnsKey(treeId), turns =>
    turns
      ? {
          prompts: turns.prompts.filter(prompt => !prompts.has(prompt.id)),
          replies: turns.replies.filter(reply => !replies.has(reply.id)),
        }
      : turns
  )
}

import type {QueryClient} from '@tanstack/react-query'
import type {CommandResult} from '@uz/contract/commands'
import type {Reply, ReplyProgress} from '@uz/contract/turns'

export type Turns = CommandResult<'tree.turns'>

export function turnsKey(treeId: string) {
  return ['turns', treeId] as const
}

export function withProgress(
  reply: Reply,
  {status, content, contextSize, contextWindow, failure}: ReplyProgress
): Reply {
  return {...reply, status, content, contextSize, contextWindow, failure}
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

type TurnIds = CommandResult<'prompt.delete'>

function without(turns: Turns, {promptIds, replyIds}: TurnIds): Turns {
  const prompts = new Set(promptIds)
  const replies = new Set(replyIds)

  return {
    prompts: turns.prompts.filter(prompt => !prompts.has(prompt.id)),
    replies: turns.replies.filter(reply => !replies.has(reply.id)),
  }
}

export function removeDeleted(
  queryClient: QueryClient,
  treeId: string,
  deleted: TurnIds
) {
  queryClient.setQueryData<Turns>(turnsKey(treeId), turns =>
    turns ? without(turns, deleted) : turns
  )
}

/** The failed Turns the Prompt took the place of go in the same update. */
export function addSent(
  queryClient: QueryClient,
  treeId: string,
  {prompt, reply, removed}: CommandResult<'prompt.send'>
) {
  queryClient.setQueryData<Turns>(turnsKey(treeId), turns => {
    const kept = turns ? without(turns, removed) : {prompts: [], replies: []}

    return {
      prompts: [...kept.prompts, prompt],
      replies: [...kept.replies, reply],
    }
  })
}

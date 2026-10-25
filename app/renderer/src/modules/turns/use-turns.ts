import type {Turns} from './live-replies'
import type {Reply} from '@uz/contract/turns'

import {bridge} from '#modules/bridge/main'
import {useQuery, useQueryClient} from '@tanstack/react-query'

import {turnsKey} from './live-replies'

/** A Tree's saved Prompts and Replies. */
export function useTurns(treeId: string) {
  return useQuery({
    queryKey: turnsKey(treeId),
    queryFn: async () => {
      const outcome = await bridge().send({type: 'tree.turns', treeId})

      if (!outcome.ok) throw new Error(outcome.error.message)

      return outcome.value
    },
  })
}

export type SendOutcome = {ok: true; reply: Reply} | {ok: false; error: string}

/**
 * Sends a Prompt answering a Reply, or the root Prompt when `parentReplyId`
 * is null. Its Reply streams in through the live events; the saved Turns are
 * fetched again in case it finished before the send returned.
 */
export function useSendPrompt(treeId: string, parentReplyId: string | null) {
  const queryClient = useQueryClient()

  return async (text: string): Promise<SendOutcome> => {
    const outcome = await bridge().send({
      type: 'prompt.send',
      treeId,
      parentReplyId,
      text,
    })

    if (!outcome.ok) return {ok: false, error: outcome.error.message}

    const {prompt, reply} = outcome.value
    queryClient.setQueryData<Turns>(turnsKey(treeId), turns => ({
      prompts: [...(turns?.prompts ?? []), prompt],
      replies: [...(turns?.replies ?? []), reply],
    }))
    void queryClient.invalidateQueries({queryKey: turnsKey(treeId)})

    return {ok: true, reply}
  }
}

/**
 * Asks main to stop a streaming Reply; its `RUN_FINISHED` follows through the
 * live events.
 */
export async function stopReply(treeId: string, replyId: string) {
  const outcome = await bridge().send({type: 'reply.stop', treeId, replyId})

  return outcome.ok ? null : outcome.error.message
}

export type RetryOutcome = {ok: true} | {ok: false; error: string}

/**
 * Runs a failed or interrupted Reply's Prompt again. Main hands back the same
 * Reply, streaming from nothing, which takes the old one's place in the saved
 * Turns; its events then stream in as usual.
 */
export function useRetryReply(treeId: string) {
  const queryClient = useQueryClient()

  return async (replyId: string): Promise<RetryOutcome> => {
    const outcome = await bridge().send({type: 'reply.retry', treeId, replyId})

    if (!outcome.ok) return {ok: false, error: outcome.error.message}

    const {reply} = outcome.value
    queryClient.setQueryData<Turns>(turnsKey(treeId), turns =>
      turns
        ? {
            ...turns,
            replies: turns.replies.map(saved =>
              saved.id === replyId ? reply : saved
            ),
          }
        : turns
    )

    return {ok: true}
  }
}

import type {Reply} from '@uz/contract/turns'

import {bridge} from '#modules/bridge/main'
import {useQuery, useQueryClient} from '@tanstack/react-query'

import {addSent, turnsKey, updateSavedReply} from './saved-turns'

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
 * Sends the root Prompt when `parentReplyId` is null. The saved Turns are
 * fetched again in case the Reply finished before the send returned.
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

    addSent(queryClient, treeId, outcome.value)
    void queryClient.invalidateQueries({queryKey: turnsKey(treeId)})

    return {ok: true, reply: outcome.value.reply}
  }
}

export type RetryOutcome = {ok: true} | {ok: false; error: string}

/**
 * Runs a failed Reply's Prompt again. Main hands back the same Reply id,
 * streaming from nothing, which takes the old one's place in the saved Turns.
 */
export function useRetryReply(treeId: string) {
  const queryClient = useQueryClient()

  return async (replyId: string): Promise<RetryOutcome> => {
    const outcome = await bridge().send({type: 'reply.retry', treeId, replyId})

    if (!outcome.ok) return {ok: false, error: outcome.error.message}

    updateSavedReply(queryClient, {treeId, replyId}, () => outcome.value.reply)

    return {ok: true}
  }
}

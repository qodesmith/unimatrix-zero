import type {Reply} from '@uz/contract/turns'

import {bridge} from '#modules/bridge/main'
import {useQuery, useQueryClient} from '@tanstack/react-query'

import {addSent, removeDeleted, turnsKey} from './saved-turns'

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

export type DeleteOutcome = {ok: true} | {ok: false; error: string}

/**
 * Takes the deleted Turns out of the saved ones at once. Either way the saved
 * Turns are fetched again, since a refusal can mean they are out of date.
 */
export function useDeletePrompt(treeId: string) {
  const queryClient = useQueryClient()

  return async (promptId: string): Promise<DeleteOutcome> => {
    const outcome = await bridge().send({
      type: 'prompt.delete',
      treeId,
      promptId,
    })

    if (outcome.ok) removeDeleted(queryClient, treeId, outcome.value)

    void queryClient.invalidateQueries({queryKey: turnsKey(treeId)})

    return outcome.ok ? {ok: true} : {ok: false, error: outcome.error.message}
  }
}

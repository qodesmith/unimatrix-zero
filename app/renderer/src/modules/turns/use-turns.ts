import type {Turns} from './live-replies'

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

/**
 * Sends a Prompt answering a Reply, or the root Prompt when `parentReplyId`
 * is null. Its Reply streams in through the live events; the saved Turns are
 * fetched again in case it finished before the send returned.
 */
export function useSendPrompt(treeId: string, parentReplyId: string | null) {
  const queryClient = useQueryClient()

  return async (text: string): Promise<string | null> => {
    const outcome = await bridge().send({
      type: 'prompt.send',
      treeId,
      parentReplyId,
      text,
    })

    if (!outcome.ok) return outcome.error.message

    const {prompt, reply} = outcome.value
    queryClient.setQueryData<Turns>(turnsKey(treeId), turns => ({
      prompts: [...(turns?.prompts ?? []), prompt],
      replies: [...(turns?.replies ?? []), reply],
    }))
    void queryClient.invalidateQueries({queryKey: turnsKey(treeId)})

    return null
  }
}

import type {ModelChoice} from '@uz/contract/providers'

import {useStateMachine} from '#modules/state-machine/main'
import {useSendPrompt} from '#modules/turns/main'

import {sendToMain} from './actions'
import {initialPromptSend, promptSendTransition} from './machine'

interface Submission {
  text: string
  attachmentIds: readonly string[]
  model: ModelChoice
  onSent: (replyId: string) => void
}

export function usePromptSend(treeId: string, parentReplyId: string | null) {
  const sendPrompt = useSendPrompt(treeId, parentReplyId)

  const [state, send] = useStateMachine({
    transition: promptSendTransition,
    initial: initialPromptSend,
  })

  function submit({text, attachmentIds, model, onSent}: Submission) {
    if (promptSendTransition(state, {type: 'submitted'}) === state) return

    send({type: 'submitted'})
    void sendToMain({
      runSend: async () => sendPrompt(text, attachmentIds, model),
      send,
      onSent,
    })
  }

  return {state, submit}
}

import type {SendOutcome} from '#modules/turns/main'
import type {PromptSendEvent} from './machine'

interface PromptSendInput {
  runSend: () => Promise<SendOutcome>
  send: (event: PromptSendEvent) => void
  onSent: (replyId: string) => void
}

export async function sendToMain({runSend, send, onSent}: PromptSendInput) {
  const outcome = await runSend()

  if (!outcome.ok) {
    send({type: 'refused', error: outcome.error})

    return
  }

  send({type: 'sent'})
  onSent(outcome.reply.id)
}

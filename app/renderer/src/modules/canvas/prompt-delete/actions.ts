import type {DeleteOutcome} from '#modules/turns/main'
import type {PromptDeleteEvent} from './machine'

interface PromptDeleteInput {
  promptId: string
  deletePrompt: (promptId: string) => Promise<DeleteOutcome>
  send: (event: PromptDeleteEvent) => void
}

/** Once deleted, the Prompt's box and so its machine are gone. */
export async function askToDelete({
  promptId,
  deletePrompt,
  send,
}: PromptDeleteInput) {
  const outcome = await deletePrompt(promptId)

  if (!outcome.ok) send({type: 'refused', error: outcome.error})
}

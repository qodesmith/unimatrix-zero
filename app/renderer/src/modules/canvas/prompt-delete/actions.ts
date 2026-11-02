import type {DeleteOutcome} from '#modules/turns/main'
import type {PromptDeleteEvent} from './machine'

interface PromptDeleteInput {
  remove: () => Promise<DeleteOutcome>
  send: (event: PromptDeleteEvent) => void
}

/** Once deleted, the Prompt's box and so its machine are gone. */
export async function askToDelete({remove, send}: PromptDeleteInput) {
  const outcome = await remove()

  if (!outcome.ok) send({type: 'refused', error: outcome.error})
}

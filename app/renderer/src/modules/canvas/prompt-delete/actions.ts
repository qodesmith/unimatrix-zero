import type {DeleteOutcome} from '#modules/turns/main'
import type {PromptDeleteEvent} from './machine'

interface PromptDeleteInput {
  runDelete: () => Promise<DeleteOutcome>
  send: (event: PromptDeleteEvent) => void
}

/** Once deleted, the Prompt's box and so its machine are gone. */
export async function askToDelete({runDelete, send}: PromptDeleteInput) {
  const outcome = await runDelete()

  if (!outcome.ok) send({type: 'refused', error: outcome.error})
}

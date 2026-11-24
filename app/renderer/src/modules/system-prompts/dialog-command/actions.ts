import type {DialogCommandEvent} from './machine'
import type {CommandOutcome, CommandType} from '@uz/contract/commands'

interface RunCommandInput {
  run: () => Promise<CommandOutcome<CommandType>>
  send: (event: DialogCommandEvent) => void
}

export async function runCommand({run, send}: RunCommandInput) {
  const outcome = await run()

  send(
    outcome.ok
      ? {type: 'succeeded'}
      : {type: 'refused', error: outcome.error.message}
  )
}

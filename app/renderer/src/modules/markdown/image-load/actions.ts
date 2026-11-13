import type {ImageLoadEvent} from './machine'
import type {CommandOutcome} from '@uz/contract/commands'

interface ImageLoadInput {
  runLoad: () => Promise<CommandOutcome<'image.load'>>
  send: (event: ImageLoadEvent) => void
}

export async function loadImage({runLoad, send}: ImageLoadInput) {
  const outcome = await runLoad()

  send(
    outcome.ok
      ? {type: 'loaded', dataUrl: outcome.value.dataUrl}
      : {type: 'refused', message: outcome.error.message}
  )
}

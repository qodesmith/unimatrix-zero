import type {AddOutcome} from '../add-file'
import type {AttachmentAddEvent} from './machine'

import {ATTACHMENT_SIZE_LIMIT} from '@uz/contract/attachments'

import {formatSize} from '../size'

interface AddInput {
  file: File
  runAdd: (file: File) => Promise<AddOutcome>
  send: (event: AttachmentAddEvent) => void
}

/** A file over the limit is refused here, before main is asked. */
export async function addToMain({file, runAdd, send}: AddInput) {
  if (file.size > ATTACHMENT_SIZE_LIMIT) {
    send({
      type: 'refused',
      error: `Larger than ${formatSize(ATTACHMENT_SIZE_LIMIT)}, the most one file can be`,
    })

    return
  }

  const outcome = await runAdd(file)

  send(
    outcome.ok
      ? {type: 'added', attachment: outcome.attachment}
      : {type: 'refused', error: outcome.error}
  )
}

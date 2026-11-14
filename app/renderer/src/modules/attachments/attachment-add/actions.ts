import type {AddOutcome} from '../add-file'
import type {AttachmentAddEvent} from './machine'
import type {Attachment} from '@uz/contract/attachments'

import {ATTACHMENT_SIZE_LIMIT} from '@uz/contract/attachments'

import {formatSize} from '../size'

interface AddInput {
  file: File
  runAdd: (file: File) => Promise<AddOutcome>
  /** Whether the add took the event: one removed while adding takes none. */
  send: (event: AttachmentAddEvent) => boolean
  onAdded: (attachment: Attachment) => void
}

/** A file over the limit is refused here, before main is asked. */
export async function addToMain({file, runAdd, send, onAdded}: AddInput) {
  if (file.size > ATTACHMENT_SIZE_LIMIT) {
    send({
      type: 'refused',
      error: `Larger than ${formatSize(ATTACHMENT_SIZE_LIMIT)}, the most one file can be`,
    })

    return
  }

  const outcome = await runAdd(file)

  if (!outcome.ok) {
    send({type: 'refused', error: outcome.error})

    return
  }

  if (send({type: 'added'})) onAdded(outcome.attachment)
}

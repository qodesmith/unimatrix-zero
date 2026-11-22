import type {Attachment, InlineForm} from '@uz/contract/attachments'

import {attachmentKind} from '@uz/contract/attachments'

export const PATH_ONLY_NOW = 'Sent by path only now'

/** What a Provider's Model does with the file, as its chip says it. */
export function modelUse(form: InlineForm | null, attachment: Attachment) {
  switch (form) {
    case 'image':
      return 'Sent as an image'
    case 'pdf':
      return 'Claude reads the whole PDF'
    case 'text':
      return 'Sent as text'
    case null:
      return attachmentKind(attachment.mediaType) === 'folder'
        ? 'The AI can open this folder'
        : 'The AI can open this file'
    default:
      throw new Error('Unknown inline form.')
  }
}

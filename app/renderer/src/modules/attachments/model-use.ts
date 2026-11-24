import type {Attachment, InlineForm} from '@uz/contract/attachments'

import {attachmentKind} from '@uz/contract/attachments'

export const PATH_ONLY_NOW = 'Sent by path only now'

export const FILE_MISSING = 'File missing'

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

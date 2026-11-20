import type {Attachment} from '@uz/contract/attachments'
import type {ProviderId} from '@uz/contract/providers'

import {attachmentKind, inlineForm} from '@uz/contract/attachments'

/** A sent attachment that Claude's media budget has since left out. */
export const PATH_ONLY_NOW = 'Sent by path only now'

/** What a Provider's Model does with the file, as its chip says it. */
export function modelUse(provider: ProviderId, attachment: Attachment) {
  switch (inlineForm(provider, attachment)) {
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

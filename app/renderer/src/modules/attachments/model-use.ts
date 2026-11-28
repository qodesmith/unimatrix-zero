import type {Attachment, InlineForm} from '@uz/contract/attachments'

import {attachmentKind} from '@uz/contract/attachments'

export const PATH_ONLY_NOW = 'Sent by path only now'

export const FILE_MISSING = 'File missing'

export const COULDNT_READ =
  'Unimatrix Zero couldn’t read this file; the AI can still open it'

function pageImagesNote(count: number) {
  return count === 1 ? '1 page image' : `${count} page images`
}

function extractedUse({extraction}: Attachment) {
  if (extraction?.status !== 'read') return null

  const {text, pageImages, imagesStopped} = extraction

  const read = [
    ...(text ? ['its text'] : []),
    ...(pageImages.length > 0 ? [pageImagesNote(pageImages.length)] : []),
  ]

  if (read.length === 0) return null

  const later = text ? 'as text only' : 'not read'
  const stopped = imagesStopped ? `; later pages ${later}` : ''

  return `The AI reads ${read.join(' and ')}${stopped}`
}

export function modelUse(form: InlineForm | null, attachment: Attachment) {
  switch (form) {
    case 'image':
      return 'Sent as an image'
    case 'pdf':
      return 'Claude reads the whole PDF'
    case 'text':
      return 'Sent as text'
    case null:
      if (attachmentKind(attachment.mediaType) === 'folder') {
        return 'The AI can open this folder'
      }

      return extractedUse(attachment) ?? 'The AI can open this file'
    default:
      throw new Error('Unknown inline form.')
  }
}

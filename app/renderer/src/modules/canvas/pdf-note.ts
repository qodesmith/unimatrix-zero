import type {TreeIndex} from './tree'
import type {Attachment} from '@uz/contract/attachments'
import type {ModelChoice} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {attachmentKind} from '@uz/contract/attachments'
import {PROVIDER_CAPABILITIES} from '@uz/contract/providers'

import {pathTo} from './tree'

interface PdfCountInput {
  index: TreeIndex
  /** The Reply the Input is attached to; null at the root. */
  attachedTo: Reply | null
  /** The draft's attachments. */
  draft: readonly Attachment[]
  /** The Model the Input would send on. */
  to: ModelChoice | null
}

function pdfs(attachments: readonly Attachment[]) {
  return attachments.filter(
    ({mediaType}) => attachmentKind(mediaType) === 'pdf'
  ).length
}

/**
 * How many PDFs a Prompt from this Input puts in front of a Provider that
 * takes them only as text: the draft's, and on a hand-over every one on the
 * Thread above, since the new session is rebuilt from the Thread.
 */
export function pdfsSentAsText({index, attachedTo, draft, to}: PdfCountInput) {
  if (!to || PROVIDER_CAPABILITIES[to.provider].pdfAttachments) return 0

  const handedOver = attachedTo !== null && attachedTo.provider !== to.provider

  const above = handedOver
    ? pathTo(index, attachedTo.id).flatMap(id => {
        const prompt = index.promptById.get(id)

        return prompt ? [pdfs(prompt.attachments)] : []
      })
    : []

  return above.reduce((sum, count) => sum + count, pdfs(draft))
}

export function pdfNote(count: number) {
  if (count === 0) return null

  const noun = count === 1 ? 'PDF' : 'PDFs'

  return `${count} ${noun} sent as text (layout and images not included)`
}

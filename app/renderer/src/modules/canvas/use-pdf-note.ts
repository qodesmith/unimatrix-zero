import type {Attachment} from '@uz/contract/attachments'
import type {ModelChoice} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {use} from 'react'

import {CanvasContext} from './canvas-context'
import {pdfNote, pdfsSentAsText} from './pdf-note'
import {indexTurns} from './tree'

const NO_TURNS = indexTurns({prompts: [], replies: []})

/** The note for an Input whose PDFs would reach its Model only as text. */
export function usePdfNote(
  attachedTo: Reply | null,
  attached: readonly Attachment[],
  to: ModelChoice | null
) {
  const index = use(CanvasContext)?.index ?? NO_TURNS

  return pdfNote(pdfsSentAsText({index, attachedTo, attached, to}))
}

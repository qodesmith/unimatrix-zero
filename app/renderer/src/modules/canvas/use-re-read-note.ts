import type {ModelChoice} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {useSettings} from '#modules/settings/main'
import {use} from 'react'

import {CanvasContext} from './canvas-context'
import {contextSizeAt, reReadNote} from './re-read'

/** The re-read note for an Input, unless the Setting hides it. */
export function useReReadNote(
  attachedTo: Reply | null,
  to: ModelChoice | null
) {
  const {reReadNote: shown} = useSettings()
  const canvas = use(CanvasContext)

  if (!shown || !canvas) return null

  return reReadNote({
    attachedTo,
    context: contextSizeAt(canvas.index, attachedTo),
    to,
  })
}

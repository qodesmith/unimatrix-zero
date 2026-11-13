import type {TreeIndex} from './tree'
import type {ModelChoice} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {PROVIDER_NAMES, SETUP_TOKENS} from '@uz/contract/providers'

/** Below this, re-reading a Thread cold costs too little to mention. */
export const RE_READ_NOTE_FROM = 20_000

/**
 * The Context size the Thread ending at `reply` carries: its own, or that of
 * the nearest Reply above it that has one. Null when none does.
 */
export function contextSizeAt(index: TreeIndex, reply: Reply | null) {
  let current = reply

  while (current) {
    if (current.contextSize !== null) return current.contextSize

    const parentReplyId = index.promptById.get(current.promptId)?.parentReplyId

    current =
      parentReplyId === undefined || parentReplyId === null
        ? null
        : (index.replyById.get(parentReplyId) ?? null)
  }

  return null
}

interface ReReadInput {
  /** The Reply the Input is attached to; null at the root. */
  attachedTo: Reply | null
  contextSize: number | null
  /** The Model the Input would send on. */
  to: ModelChoice | null
}

/**
 * What the Input says before a Prompt that re-reads the Thread cold, or null:
 * a Thread going to another Provider rebuilds its session from the Thread.
 */
export function reReadNote({attachedTo, contextSize, to}: ReReadInput) {
  if (!attachedTo || !to || contextSize === null) return null

  if (to.provider === attachedTo.provider) return null

  const tokens = contextSize + SETUP_TOKENS[to.provider]

  if (tokens < RE_READ_NOTE_FROM) return null

  const thousands = Math.round(tokens / 1000)

  return `Switching to ${PROVIDER_NAMES[to.provider]} will re-read ~${thousands}k tokens of this conversation (uses more of your limit).`
}

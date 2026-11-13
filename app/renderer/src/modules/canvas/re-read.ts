import type {TreeIndex} from './tree'
import type {ModelChoice, ProviderId} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {PROVIDER_NAMES} from '@uz/contract/providers'

import {previousReply} from './tree'

/** Below this, re-reading a Thread cold costs too little to mention. */
export const RE_READ_NOTE_FROM = 20_000

/**
 * About how many tokens a new session's first turn carries before the Thread:
 * the vendor program's own instructions, as the app starts it. Measured from
 * a recorded first Reply to a one-line Prompt, rounded up.
 */
export const SETUP_TOKENS: Record<ProviderId, number> = {
  claude: 1000,
  chatgpt: 15_000,
}

/** A Context size, and the Provider whose setup it includes. */
export interface MeasuredContext {
  provider: ProviderId
  size: number
}

/**
 * The Context size the Thread ending at `reply` carries: its own, or that of
 * the nearest Reply above it that has one. Null when none does.
 */
export function contextSizeAt(
  index: TreeIndex,
  reply: Reply | null
): MeasuredContext | null {
  let current = reply

  while (current) {
    if (current.contextSize !== null) {
      return {provider: current.provider, size: current.contextSize}
    }

    current = previousReply(index, current)
  }

  return null
}

interface ReReadInput {
  /** The Reply the Input is attached to; null at the root. */
  attachedTo: Reply | null
  context: MeasuredContext | null
  /** The Model the Input would send on. */
  to: ModelChoice | null
}

/**
 * What the Input says before a Prompt that re-reads the Thread cold, or null:
 * a Thread going to another Provider rebuilds its session from the Thread.
 */
export function reReadNote({attachedTo, context, to}: ReReadInput) {
  if (!attachedTo || !to || !context) return null

  if (to.provider === attachedTo.provider) return null

  const tokens =
    context.size - SETUP_TOKENS[context.provider] + SETUP_TOKENS[to.provider]

  if (tokens < RE_READ_NOTE_FROM) return null

  const thousands = Math.round(tokens / 1000)

  return `Switching to ${PROVIDER_NAMES[to.provider]} will re-read ~${thousands}k tokens of this conversation (uses more of your limit).`
}

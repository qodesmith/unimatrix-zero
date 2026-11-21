import type {TreeIndex} from './tree'
import type {MediaBudgetUse} from '@uz/contract/attachments'
import type {Prompt, Reply} from '@uz/contract/turns'

import {planInline} from '@uz/contract/attachments'

import {pathTo} from './tree'

/** The Prompts of the Thread that ends at a Reply, oldest first. */
function promptsTo(index: TreeIndex, replyId: string): Prompt[] {
  return pathTo(index, replyId).flatMap(id => index.promptById.get(id) ?? [])
}

/**
 * Claude's media budget as the Thread up to a Claude Reply uses it. Null for
 * another Provider's Reply, which has no such budget, and for a Thread with no
 * attachments.
 */
export function mediaBudgetUseOf(
  index: TreeIndex,
  reply: Reply
): MediaBudgetUse | null {
  if (reply.provider !== 'claude') return null

  const attachments = promptsTo(index, reply.id).map(
    prompt => prompt.attachments
  )

  return attachments.some(ofPrompt => ofPrompt.length > 0)
    ? planInline('claude', attachments).budget
    : null
}

const NONE: ReadonlySet<string> = new Set()

/**
 * The ids of a Prompt's attachments that went inline, and that Claude's media
 * budget now leaves out of the Thread ending at a Reply. None unless the
 * Reply is Claude's.
 */
export function pathOnlyNow(
  index: TreeIndex,
  threadEnd: Reply | null,
  prompt: Prompt
): ReadonlySet<string> {
  if (threadEnd?.provider !== 'claude' || prompt.attachments.length === 0) {
    return NONE
  }

  const prompts = promptsTo(index, threadEnd.id)

  const now = planInline(
    'claude',
    prompts.map(one => one.attachments)
  ).pathOnlyNow[prompts.findIndex(one => one.id === prompt.id)]

  return new Set(
    prompt.attachments.filter((_, at) => now?.[at] === true).map(({id}) => id)
  )
}

/**
 * A failed Reply's Prompt is back in the Input, so its Thread ends at the Reply
 * above.
 */
function sentEnd(index: TreeIndex, replyId: string): Reply | null {
  const reply = index.replyById.get(replyId)

  if (reply?.status !== 'failed') return reply ?? null

  const above = index.promptById.get(reply.promptId)?.parentReplyId ?? null

  return above === null ? null : (index.replyById.get(above) ?? null)
}

/**
 * The Reply whose Thread says how a Prompt's attachments go now: the active
 * Reply when the Prompt is on its Thread. Off it, the Prompt is the newest of
 * its own Thread, where the budget has left out nothing it sent inline.
 */
export function threadEndFor(
  index: TreeIndex,
  activeReplyId: string | null,
  prompt: Prompt
): Reply | null {
  const end = activeReplyId === null ? null : sentEnd(index, activeReplyId)

  return end !== null && pathTo(index, end.id).includes(prompt.id) ? end : null
}

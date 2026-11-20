import type {TreeIndex} from './tree'
import type {MediaBudgetUse} from '@uz/contract/attachments'
import type {Prompt, Reply} from '@uz/contract/turns'

import {inlineForm, planInline} from '@uz/contract/attachments'

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
export function inlineMediaOf(
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
 * The ids of a Prompt's attachments that Claude takes inline, and that its
 * media budget now leaves out of the Thread ending at a Reply. None unless
 * the Reply is Claude's.
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

  const planned = planInline(
    'claude',
    prompts.map(one => one.attachments)
  ).forms[prompts.findIndex(one => one.id === prompt.id)]

  return new Set(
    prompt.attachments
      .filter((attachment, at) => {
        const native = inlineForm('claude', attachment)

        return (
          (native === 'image' || native === 'pdf') && planned?.[at] === null
        )
      })
      .map(({id}) => id)
  )
}

/**
 * The Reply whose Thread says how a Prompt's attachments go now: the active
 * Reply when the Prompt is on its Thread, otherwise the Prompt's own Reply.
 */
export function threadEndFor(
  index: TreeIndex,
  activeReplyId: string | null,
  prompt: Prompt
): Reply | null {
  const active =
    activeReplyId !== null && pathTo(index, activeReplyId).includes(prompt.id)
      ? index.replyById.get(activeReplyId)
      : undefined

  return active ?? index.replyByPrompt.get(prompt.id) ?? null
}

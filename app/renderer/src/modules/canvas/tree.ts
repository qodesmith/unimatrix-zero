import type {Turns} from '#modules/turns/main'
import type {Prompt, Reply} from '@uz/contract/turns'

/** Oldest first; ids (UUIDv7, ADR 0002) break a tie the same way every time. */
function oldestFirst<T extends {createdAt: string; id: string}>(a: T, b: T) {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

/** A Tree's Turns, indexed for walking it in either direction. */
export interface TreeIndex {
  prompts: Prompt[]
  replies: Reply[]
  promptById: Map<string, Prompt>
  replyById: Map<string, Reply>
  replyByPrompt: Map<string, Reply>
  /** Each Reply's Prompts, oldest first; the root Prompt is under null. */
  promptsByParent: Map<string | null, Prompt[]>
}

export function indexTurns(turns: Turns): TreeIndex {
  const prompts = turns.prompts.toSorted(oldestFirst)
  const replies = turns.replies.toSorted(oldestFirst)
  const promptsByParent = new Map<string | null, Prompt[]>()

  for (const prompt of prompts) {
    const siblings = promptsByParent.get(prompt.parentReplyId) ?? []
    siblings.push(prompt)
    promptsByParent.set(prompt.parentReplyId, siblings)
  }

  return {
    prompts,
    replies,
    promptById: new Map(prompts.map(prompt => [prompt.id, prompt])),
    replyById: new Map(replies.map(reply => [reply.id, reply])),
    replyByPrompt: new Map(replies.map(reply => [reply.promptId, reply])),
    promptsByParent,
  }
}

export function isEmpty(index: TreeIndex) {
  return index.prompts.length === 0
}

/** The Prompts answering a Reply, oldest first; the root Prompt under null. */
export function branchesOf(index: TreeIndex, replyId: string | null): Prompt[] {
  return index.promptsByParent.get(replyId) ?? []
}

/**
 * The Thread up to a Turn: every Turn id from the root to it, in order. Empty
 * when the Tree has no such Turn.
 */
export function pathTo(index: TreeIndex, turnId: string): string[] {
  const path: string[] = []
  let current: string | null = turnId

  while (current !== null) {
    const id: string = current
    const reply = index.replyById.get(id)

    if (reply) {
      path.unshift(id)
      current = reply.promptId
      continue
    }

    const prompt = index.promptById.get(id)

    if (!prompt) break

    path.unshift(id)
    current = prompt.parentReplyId
  }

  return path
}

/** The Reply of the Thread's previous Exchange, whose Context size it grew from. */
export function previousReply(index: TreeIndex, reply: Reply): Reply | null {
  const parentReplyId =
    index.promptById.get(reply.promptId)?.parentReplyId ?? null

  return parentReplyId === null
    ? null
    : (index.replyById.get(parentReplyId) ?? null)
}

/** The newest Reply: where the user left off until they pick a Thread. */
export function newestReply(index: TreeIndex): Reply | null {
  return index.replies.at(-1) ?? null
}

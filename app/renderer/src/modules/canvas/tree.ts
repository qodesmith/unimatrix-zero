import type {Turns} from '#modules/turns/main'
import type {Prompt, Reply} from '@uz/contract/turns'

/** Oldest first; ids (UUIDv7) break a tie the same way every time. */
function oldestFirst<T extends {createdAt: string; id: string}>(a: T, b: T) {
  return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
}

export interface TreeIndex {
  prompts: Prompt[]
  replies: Reply[]
  promptById: Map<string, Prompt>
  replyById: Map<string, Reply>
  replyByPrompt: Map<string, Reply>
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

export function branchesOf(index: TreeIndex, replyId: string | null): Prompt[] {
  return index.promptsByParent.get(replyId) ?? []
}

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

export function previousReply(index: TreeIndex, reply: Reply): Reply | null {
  const parentReplyId =
    index.promptById.get(reply.promptId)?.parentReplyId ?? null

  return parentReplyId === null
    ? null
    : (index.replyById.get(parentReplyId) ?? null)
}

export function isFork(index: TreeIndex, replyId: string) {
  return branchesOf(index, replyId).length >= 2
}

export function newestReply(index: TreeIndex): Reply | null {
  return index.replies.at(-1) ?? null
}

export function replyOf(index: TreeIndex, turnId: string): Reply | null {
  return index.replyById.get(turnId) ?? index.replyByPrompt.get(turnId) ?? null
}

export function turnsFrom(index: TreeIndex, promptId: string): string[] {
  const ids: string[] = []
  const prompts = [promptId]

  for (const id of prompts) {
    ids.push(id)
    const reply = index.replyByPrompt.get(id)

    if (!reply) continue

    ids.push(reply.id)
    prompts.push(...branchesOf(index, reply.id).map(branch => branch.id))
  }

  return ids
}

export function repliesUnder(index: TreeIndex, replyId: string): Reply[] {
  return branchesOf(index, replyId)
    .flatMap(branch => turnsFrom(index, branch.id))
    .flatMap(id => index.replyById.get(id) ?? [])
}

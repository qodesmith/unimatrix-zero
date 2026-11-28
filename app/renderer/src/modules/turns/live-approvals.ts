import type {ApprovalAction} from '@uz/contract/permissions'
import type {
  ApprovalAnswer,
  ReplyEvent,
  ReplyPart,
  StreamingReply,
} from '@uz/contract/turns'

type ReviewFinished = Extract<ReplyEvent, {type: 'REVIEW_FINISHED'}>

type ApprovalRequested = Extract<ReplyEvent, {type: 'APPROVAL_REQUESTED'}>

export type ReviewDecision = Pick<ReviewFinished, 'decision' | 'reason'>

interface Placed {
  id: string
  action: ApprovalAction
  subagentId: string | null
  beforePart: number
  arrivedAt: number
}

export type ApprovalItem =
  | (Placed & {kind: 'card'; answer: ApprovalAnswer | null})
  | (Placed & {kind: 'review'; decision: ReviewDecision | null})

export type ApprovalsByReply = Record<string, ApprovalItem[]>

export type SubagentsByReply = Record<string, Record<string, string>>

function partsBefore(content: ReplyPart[], toolCallId: string | undefined) {
  const at = content.findIndex(
    part => part.type === 'tool-call' && part.toolCallId === toolCallId
  )

  return at === -1 ? content.length : at + 1
}

function isOpen(item: ApprovalItem) {
  return item.kind === 'card' ? item.answer === null : item.decision === null
}

function isRetry(event: ReplyEvent) {
  return event.type === 'RUN_STARTED' && event.subagentId === undefined
}

function withoutReply<T>(byReply: Record<string, T>, replyId: string) {
  if (!(replyId in byReply)) return byReply

  return Object.fromEntries(
    Object.entries(byReply).filter(([id]) => id !== replyId)
  )
}

function placed(
  event: Extract<ReplyEvent, {type: 'APPROVAL_REQUESTED' | 'REVIEW_STARTED'}>,
  content: ReplyPart[],
  now: number
): ApprovalItem {
  const at = {
    action: event.action,
    subagentId: event.subagentId ?? null,
    beforePart: partsBefore(content, event.toolCallId),
    arrivedAt: now,
  }

  return event.type === 'APPROVAL_REQUESTED'
    ? {...at, id: event.approvalId, kind: 'card', answer: null}
    : {...at, id: event.reviewId, kind: 'review', decision: null}
}

function foldItems(
  items: ApprovalItem[],
  event: ReplyEvent,
  content: ReplyPart[],
  now: number
): ApprovalItem[] {
  if (event.type === 'APPROVAL_REQUESTED' || event.type === 'REVIEW_STARTED') {
    return [...items, placed(event, content, now)]
  }

  if (event.type === 'APPROVAL_RESOLVED') {
    return items.map(item =>
      item.kind === 'card' && item.id === event.approvalId
        ? {...item, answer: event.answer}
        : item
    )
  }

  if (event.type === 'REVIEW_FINISHED') {
    const {decision, reason} = event

    return items.map(item =>
      item.kind === 'review' && item.id === event.reviewId
        ? {...item, decision: {decision, reason}}
        : item
    )
  }

  if (event.type === 'RUN_FINISHED' && items.some(isOpen)) {
    return items.filter(item => !isOpen(item))
  }

  return items
}

export function approvalsAfter(
  approvals: ApprovalsByReply,
  event: ReplyEvent,
  content: ReplyPart[],
  now: number
): ApprovalsByReply {
  const {replyId} = event

  if (isRetry(event)) return withoutReply(approvals, replyId)

  const items = approvals[replyId] ?? []
  const next = foldItems(items, event, content, now)

  return next === items ? approvals : {...approvals, [replyId]: next}
}

/** A card open here that main no longer lists was answered or dropped meanwhile. */
export function approvalsFromSnapshot(
  approvals: ApprovalsByReply,
  waiting: ApprovalRequested[],
  replies: StreamingReply[],
  now: number
): ApprovalsByReply {
  const listed = new Set(waiting.map(event => event.approvalId))

  const next: ApprovalsByReply = Object.fromEntries(
    Object.entries(approvals).map(([replyId, items]) => [
      replyId,
      items.filter(
        item => !(item.kind === 'card' && isOpen(item) && !listed.has(item.id))
      ),
    ])
  )

  for (const event of waiting) {
    const items = next[event.replyId] ?? []

    if (items.some(item => item.id === event.approvalId)) continue

    const content =
      replies.find(reply => reply.replyId === event.replyId)?.content ?? []

    next[event.replyId] = [...items, placed(event, content, now)]
  }

  return next
}

export function subagentsAfter(subagents: SubagentsByReply, event: ReplyEvent) {
  const {replyId} = event

  if (isRetry(event)) return withoutReply(subagents, replyId)

  if (event.type !== 'SUBAGENT_STARTED') return subagents

  return {
    ...subagents,
    [replyId]: {
      ...subagents[replyId],
      [event.subagentId]: event.description,
    },
  }
}

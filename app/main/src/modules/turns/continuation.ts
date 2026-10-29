import type {Database} from '#modules/database/main'
import type {ReplyRequest, ReplySession} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {and, eq, ne} from 'drizzle-orm'

const {prompts, replies, systemPrompts} = schema

/** A Reply ended early with its text kept; its Provider may not have saved it. */
const CUT_SHORT = new Set<Reply['status']>(['stopped', 'interrupted'])

type ContinuedSession = Extract<ReplySession, {type: 'continue' | 'fork'}>

/** A null session means the Provider has nothing of the Thread and starts one. */
export interface Continuation {
  provider: ProviderId
  session: ContinuedSession | null
}

export interface Recovery {
  provider: ProviderId
  model: string
  systemPrompt: string
  text: string
  session: ReplyRequest['session']
}

function answered(db: Database, replyId: string, except?: string) {
  const prompt = db
    .select({id: prompts.id})
    .from(prompts)
    .where(
      and(
        eq(prompts.parentReplyId, replyId),
        except === undefined ? undefined : ne(prompts.id, except)
      )
    )
    .get()

  return prompt !== undefined
}

/**
 * Forks when the Reply already has a Prompt after it other than `except`, the
 * Prompt being run again. A Reply cut short before its Provider saved it
 * continues from the Reply its own Prompt answers, whose session holds that
 * Prompt.
 */
export function continuation(
  db: Database,
  treeId: string,
  replyId: string,
  except?: string
): Continuation | null {
  const row = db
    .select()
    .from(replies)
    .where(and(eq(replies.id, replyId), eq(replies.treeId, treeId)))
    .get()

  if (!row) return null

  if (row.status === 'streaming') {
    throw new Error('Wait for this Reply to finish before continuing.')
  }

  if (row.sessionId !== null && row.sessionMessageId !== null) {
    return {
      provider: row.provider,
      session: {
        type: answered(db, replyId, except) ? 'fork' : 'continue',
        sessionId: row.sessionId,
        messageId: row.sessionMessageId,
      },
    }
  }

  if (!CUT_SHORT.has(row.status)) {
    throw new Error(
      'This Reply can’t be continued: its Provider never saved it.'
    )
  }

  const prompt = db
    .select({parentReplyId: prompts.parentReplyId})
    .from(prompts)
    .where(eq(prompts.id, row.promptId))
    .get()

  const parentReplyId = prompt?.parentReplyId ?? null

  const before =
    parentReplyId === null
      ? null
      : continuation(db, treeId, parentReplyId, row.promptId)

  const session = before?.session ?? null

  return {
    provider: row.provider,
    session: session && {
      ...session,
      type:
        session.type === 'fork' || answered(db, replyId, except)
          ? 'fork'
          : 'continue',
    },
  }
}

/**
 * Rewinds the session to the Reply its Prompt answers. A Prompt that started a
 * Branch forks again instead, and one answering a Reply its Provider never
 * saved skips the rewind, which would drop that Reply's Prompt too.
 */
export function recovery(
  db: Database,
  treeId: string,
  replyId: string
): Recovery | null {
  const row = db
    .select()
    .from(replies)
    .where(and(eq(replies.id, replyId), eq(replies.treeId, treeId)))
    .get()

  if (!row) return null

  if (row.status !== 'failed') {
    throw new Error('Only a Reply that failed can be retried.')
  }

  const prompt = db
    .select()
    .from(prompts)
    .where(eq(prompts.id, row.promptId))
    .get()

  const systemPrompt = db
    .select({text: systemPrompts.text})
    .from(systemPrompts)
    .where(eq(systemPrompts.id, row.systemPromptId))
    .get()

  if (!prompt || !systemPrompt) throw new Error('That Reply was not saved.')

  const continued =
    prompt.parentReplyId === null
      ? null
      : continuation(db, treeId, prompt.parentReplyId, prompt.id)

  if (prompt.parentReplyId !== null && !continued) {
    throw new Error('The Reply this one’s Prompt answers no longer exists.')
  }

  const parent =
    prompt.parentReplyId === null
      ? undefined
      : db
          .select()
          .from(replies)
          .where(eq(replies.id, prompt.parentReplyId))
          .get()

  return {
    provider: row.provider,
    model: row.model,
    systemPrompt: systemPrompt.text,
    text: prompt.text,
    session: continued?.session
      ? rewound(continued.session, parent, row)
      : null,
  }
}

type ReplyRow = typeof replies.$inferSelect

function promptIn(session: ContinuedSession, reply: ReplyRow | undefined) {
  return reply?.sessionId === session.sessionId
    ? (reply.sessionPromptId ?? null)
    : null
}

/**
 * Rewinds to the Reply answered once its Provider saved it. One cut short
 * before then left only its Prompt in the session, so the cut goes after that
 * Prompt and before the failed attempt's own.
 */
function rewound(
  session: ContinuedSession,
  parent: ReplyRow | undefined,
  failed: ReplyRow
): ReplySession {
  if (session.type === 'fork') return session

  const {sessionId, messageId} = session

  if (parent?.sessionMessageId === messageId) {
    return {type: 'rewind', sessionId, messageId}
  }

  const keepThrough = promptIn(session, parent)
  const dropFrom = promptIn(session, failed)

  return keepThrough === null && dropFrom === null
    ? session
    : {type: 'cut', sessionId, messageId, keepThrough, dropFrom}
}

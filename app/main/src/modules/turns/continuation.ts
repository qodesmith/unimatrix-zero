import type {Database} from '#modules/database/main'
import type {
  DeletionCut,
  ReplyRequest,
  ReplySession,
  SessionRef,
} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {positionOf} from '#modules/sessions/main'
import {and, eq, ne} from 'drizzle-orm'

import {reaching, targetOf} from './reach'

const {prompts, replies, systemPrompts} = schema

/** A Reply ended early with its text kept; its Provider may not have saved it. */
const CUT_SHORT = new Set<Reply['status']>(['stopped', 'interrupted'])

type ContinuedSession = Extract<
  ReplySession,
  {type: 'continue' | 'fork' | 'cut'}
>

type ReplyRow = typeof replies.$inferSelect

/** A null session means the Provider has nothing of the Thread. */
export interface Continuation {
  provider: ProviderId
  session: ContinuedSession | null
}

export interface Recovery {
  provider: ProviderId
  model: string
  systemPrompt: string
  text: string
  promptId: string
  parentReplyId: string | null
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

function resumed(
  db: Database,
  treeId: string,
  row: ReplyRow,
  except?: string
): ContinuedSession | null {
  if (row.sessionId !== null && row.sessionMessageId !== null) {
    return {
      type: answered(db, row.id, except) ? 'fork' : 'continue',
      sessionId: row.sessionId,
      messageId: row.sessionMessageId,
    }
  }

  if (!CUT_SHORT.has(row.status)) return null

  const prompt = db
    .select({parentReplyId: prompts.parentReplyId})
    .from(prompts)
    .where(eq(prompts.id, row.promptId))
    .get()

  const parentReplyId = prompt?.parentReplyId ?? null

  const before =
    parentReplyId === null
      ? null
      : planned(db, treeId, parentReplyId, row.promptId)

  // The Reply above went on in its own Provider's session, which another's
  // Reply was never in.
  const session = before?.provider === row.provider ? before.session : null

  return (
    session && keepingPrompt(db, row, session, answered(db, row.id, except))
  )
}

/** `session` is where the Reply above goes on. */
function keepingPrompt(
  db: Database,
  row: ReplyRow,
  session: ContinuedSession,
  forks: boolean
): ContinuedSession {
  const own = ownPrompt(db, row)

  if (own && own.sessionId !== session.sessionId) {
    return {type: forks ? 'fork' : 'continue', ...own}
  }

  if (session.type !== 'fork' && !forks) return session

  return {type: 'fork', ...sessionRef(session), ...own}
}

function sessionRef({sessionId, messageId}: SessionRef) {
  return {sessionId, messageId}
}

/**
 * The Reply's session at its Prompt, when the app's copy holds that Prompt. A
 * Reply that began a fork has it in a session the Reply above was never in.
 */
function ownPrompt(db: Database, row: ReplyRow): SessionRef | null {
  const {sessionId, sessionPromptId: messageId} = row

  if (sessionId === null || messageId === null) return null

  return positionOf(db, sessionId, messageId) === null
    ? null
    : {sessionId, messageId}
}

/** The Reply, or only its Prompt when its Provider never saved it. */
function lastKept(row: ReplyRow, session: SessionRef) {
  return row.sessionMessageId === null
    ? (promptIn(session, row) ?? session.messageId)
    : session.messageId
}

function cutBack(
  row: ReplyRow,
  session: SessionRef,
  dropFrom: string
): DeletionCut {
  return {
    type: 'cut',
    ...sessionRef(session),
    keepThrough: lastKept(row, session),
    dropFrom,
  }
}

interface Plan extends Continuation {
  /** The last entry a `continue` keeps of its session. */
  lastKept: string | null
}

function planned(
  db: Database,
  treeId: string,
  replyId: string,
  except?: string
): Plan | null {
  const row = db
    .select()
    .from(replies)
    .where(and(eq(replies.id, replyId), eq(replies.treeId, treeId)))
    .get()

  if (!row) return null

  if (row.status === 'streaming') {
    throw new Error('Wait for this Reply to finish before continuing.')
  }

  const session = resumed(db, treeId, row, except)
  const dropFrom = row.sessionDropFrom

  return {
    provider: row.provider,
    lastKept: session && lastKept(row, session),
    session:
      session?.type === 'continue' && dropFrom !== null
        ? cutBack(row, session, dropFrom)
        : session,
  }
}

/**
 * Forks when the Reply already has a Prompt after it other than `except`, the
 * one being run again. A Reply its Provider never saved continues from the
 * Reply its Prompt answers, or from its own Prompt in a fork it began, and a
 * session still holding deleted Turns is cut. A session that compacted after
 * the Reply is forked from the part before. The session is the Reply's own
 * Provider's: a Prompt sent to another has none.
 */
export function continuation(
  db: Database,
  treeId: string,
  replyId: string,
  except?: string
): Continuation | null {
  const plan = planned(db, treeId, replyId, except)

  if (!plan) return null

  const {provider, session} = plan

  return {
    provider,
    session:
      session &&
      reaching(
        db,
        session,
        session.type === 'continue' ? plan.lastKept : targetOf(session)
      ),
  }
}

/**
 * The cut from the first deleted Reply that went on in the parent's session.
 * `deleted` runs from the top; a Branch below forks a session of its own.
 */
export function cutBelow(
  db: Database,
  treeId: string,
  prompt: {id: string; parentReplyId: string | null},
  deleted: Pick<ReplyRow, 'sessionId' | 'sessionPromptId'>[]
) {
  if (prompt.parentReplyId === null) return null

  const row = db
    .select()
    .from(replies)
    .where(eq(replies.id, prompt.parentReplyId))
    .get()

  const session = row && resumed(db, treeId, row, prompt.id)

  const dropFrom =
    deleted.find(
      reply =>
        reply.sessionId === session?.sessionId && reply.sessionPromptId !== null
    )?.sessionPromptId ?? null

  if (!row || !session || dropFrom === null) return null

  return {
    replyId: row.id,
    provider: row.provider,
    session: cutBack(row, session, dropFrom),
  }
}

/**
 * A Prompt that started a Branch forks again, and one answering a Reply its
 * Provider never saved skips the rewind, which would drop that Reply's Prompt.
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
    promptId: prompt.id,
    parentReplyId: prompt.parentReplyId,
    session:
      continued?.session && continued.provider === row.provider
        ? rewound(continued.session, parent, row)
        : null,
  }
}

function promptIn(session: SessionRef, reply: ReplyRow | undefined) {
  return reply?.sessionId === session.sessionId
    ? (reply.sessionPromptId ?? null)
    : null
}

/**
 * A cut of deleted Turns already drops the failed attempt. A parent its
 * Provider never saved left only its Prompt in the session, so the cut goes
 * after that Prompt and before the failed attempt's. It always names what to
 * keep: Claude resumes a cut that names nothing at the failed attempt.
 */
function rewound(
  session: ContinuedSession,
  parent: ReplyRow | undefined,
  failed: ReplyRow
): ReplySession {
  if (session.type === 'fork' || session.type === 'cut') return session

  const {sessionId, messageId} = session

  if (parent?.sessionMessageId === messageId) {
    return {type: 'rewind', sessionId, messageId}
  }

  const kept = promptIn(session, parent)
  const dropFrom = promptIn(session, failed)

  if (kept === null && dropFrom === null) return session

  return {
    type: 'cut',
    sessionId,
    messageId,
    keepThrough: kept ?? messageId,
    dropFrom,
  }
}

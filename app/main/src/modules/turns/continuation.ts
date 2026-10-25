import type {Database} from '#modules/database/main'
import type {ReplyRequest} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {Reply} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {and, eq, ne} from 'drizzle-orm'

const {prompts, replies, systemPrompts} = schema

/** A Reply ended early with its text kept; its Provider may not have saved it. */
const CUT_SHORT = new Set<Reply['status']>(['stopped', 'interrupted'])

/**
 * Where a Thread continues: a Reply's Provider, and its session there; null
 * session when the Provider has nothing of the Thread, so it starts one.
 */
export interface Continuation {
  provider: ProviderId
  session: ReplyRequest['session']
}

/** How a Reply runs again: its Prompt, and the session it goes to. */
export interface Recovery {
  provider: ProviderId
  model: string
  systemPrompt: string
  text: string
  session: Continuation['session']
}

/** Whether a Prompt other than `except` answers the Reply. */
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
 * Where a Thread continues from this Reply: its Provider and session,
 * which the next Prompt forks when the Reply already has a Prompt after
 * it, other than `except`, the Prompt being run again. A Reply stopped or
 * interrupted before its Provider saved it continues from the Reply its
 * own Prompt answers, since the Provider session stands there with the
 * Prompt in it; a Prompt after the cut-short Reply forks that session all
 * the same. Null when the Tree has no such Reply.
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
        sessionId: row.sessionId,
        messageId: row.sessionMessageId,
        fork: answered(db, replyId, except),
        rewind: false,
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
      fork: session.fork || answered(db, replyId, except),
    },
  }
}

/**
 * How a failed Reply runs again: its Prompt, to the same Provider and
 * Model, in the session of the Reply its Prompt answers, rewound to
 * there, since the Reply's own Turn may be in it. A Prompt that started
 * a Branch forks again instead. Null when the Tree has no such Reply;
 * throws for one that didn't fail.
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

  return {
    provider: row.provider,
    model: row.model,
    systemPrompt: systemPrompt.text,
    text: prompt.text,
    session: continued?.session
      ? {...continued.session, rewind: !continued.session.fork}
      : null,
  }
}

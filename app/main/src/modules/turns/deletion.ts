import type {Database} from '#modules/database/main'
import type {PromptRecorded, SessionCutReport} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'

import {schema} from '#modules/database/main'
import {and, asc, eq, inArray, isNull} from 'drizzle-orm'

import {continuation, cutBelow, recovery} from './continuation'

const {prompts, replies} = schema

type ReplyRow = typeof replies.$inferSelect

type Writer = Pick<Database, 'update' | 'delete'>

export interface Removal {
  promptIds: string[]
  cut: ReturnType<typeof cutBelow>
}

/** Sets the cut on the Reply above in the same step. */
export function removeTurns(tx: Writer, {promptIds, cut}: Removal) {
  if (cut) {
    tx.update(replies)
      .set({sessionDropFrom: cut.session.dropFrom})
      .where(eq(replies.id, cut.replyId))
      .run()
  }

  // The Turns below go by cascade. Their Provider session data stays.
  tx.delete(prompts).where(inArray(prompts.id, promptIds)).run()
}

function below(db: Database, promptId: string) {
  const promptIds: string[] = []
  const found: ReplyRow[] = []
  let next = [promptId]

  while (next.length > 0) {
    promptIds.push(...next)

    const answers = db
      .select()
      .from(replies)
      .where(inArray(replies.promptId, next))
      .all()

    found.push(...answers)

    next = db
      .select({id: prompts.id})
      .from(prompts)
      .where(
        inArray(
          prompts.parentReplyId,
          answers.map(reply => reply.id)
        )
      )
      .all()
      .map(prompt => prompt.id)
  }

  return {promptIds, replies: found}
}

export function deleteBelow(db: Database, treeId: string, promptId: string) {
  const prompt = db
    .select()
    .from(prompts)
    .where(and(eq(prompts.id, promptId), eq(prompts.treeId, treeId)))
    .get()

  if (!prompt) return null

  const deleted = below(db, promptId)

  if (deleted.replies.some(reply => reply.status === 'streaming')) {
    throw new Error(
      'Wait for the Replies below to finish, or stop them, before deleting.'
    )
  }

  const cut = cutBelow(db, treeId, prompt, deleted.replies)

  db.transaction(tx => removeTurns(tx, {promptIds: [promptId], cut}))

  return {
    promptIds: deleted.promptIds,
    replyIds: deleted.replies.map(reply => reply.id),
    cut,
  }
}

/**
 * The failed exchanges a Prompt sent from `parentReplyId`, or as the root when
 * null, takes the place of, and the session a Retry of one would resume: it
 * holds nothing of the failed attempt.
 */
export function failedToReplace(
  db: Database,
  treeId: string,
  parentReplyId: string | null
) {
  const failed = db
    .select({promptId: prompts.id, replyId: replies.id})
    .from(prompts)
    .innerJoin(replies, eq(replies.promptId, prompts.id))
    .where(
      and(
        eq(prompts.treeId, treeId),
        parentReplyId === null
          ? isNull(prompts.parentReplyId)
          : eq(prompts.parentReplyId, parentReplyId),
        eq(replies.status, 'failed')
      )
    )
    .orderBy(asc(prompts.createdAt), asc(prompts.id))
    .all()

  const [first] = failed

  if (!first) return null

  const removed = failed.map(row => below(db, row.promptId))
  const removedReplies = removed.flatMap(turns => turns.replies)

  return {
    promptIds: removed.flatMap(turns => turns.promptIds),
    replyIds: removedReplies.map(reply => reply.id),
    session: recovery(db, treeId, first.replyId)?.session ?? null,
    cut: cutBelow(
      db,
      treeId,
      {id: first.promptId, parentReplyId},
      removedReplies
    ),
  }
}

/** A newer deletion below the Reply keeps its own cut. */
export function clearCutOnReport(
  db: Database,
  provider: ProviderId,
  {treeId, replyId, dropFrom}: SessionCutReport
) {
  db.update(replies)
    .set({sessionDropFrom: null})
    .where(
      and(
        eq(replies.id, replyId),
        eq(replies.treeId, treeId),
        eq(replies.provider, provider),
        eq(replies.sessionDropFrom, dropFrom)
      )
    )
    .run()
}

function parentOf(db: Database, treeId: string, replyId: string) {
  const row = db
    .select({promptId: prompts.id, parentReplyId: prompts.parentReplyId})
    .from(replies)
    .innerJoin(prompts, eq(prompts.id, replies.promptId))
    .where(and(eq(replies.id, replyId), eq(replies.treeId, treeId)))
    .get()

  const parentReplyId = row?.parentReplyId ?? null

  return row && parentReplyId !== null ? {...row, parentReplyId} : null
}

function clearCut(db: Database, replyId: string) {
  db.update(replies)
    .set({sessionDropFrom: null})
    .where(eq(replies.id, replyId))
    .run()
}

/**
 * The session holds the Prompt right after the Reply it answers, so any cut
 * there is made. A Prompt that went into a fork leaves the session as it was,
 * unless the fork was served only through that Reply: it holds nothing after
 * it, and so does every later one.
 */
export function clearCutOnPrompt(
  db: Database,
  {treeId, replyId, session}: PromptRecorded
) {
  const prompt = parentOf(db, treeId, replyId)

  if (!prompt) return

  const continued = continuation(
    db,
    treeId,
    prompt.parentReplyId,
    prompt.promptId
  )

  const planned = continued?.session

  if (
    planned?.sessionId === session.sessionId ||
    (planned?.type === 'fork' && planned.servedThrough !== undefined)
  ) {
    clearCut(db, prompt.parentReplyId)
  }
}

/** Only a cut session drops a Prompt, so the cut is made. */
export function clearCutOnDrop(db: Database, treeId: string, replyId: string) {
  const prompt = parentOf(db, treeId, replyId)

  if (prompt) clearCut(db, prompt.parentReplyId)
}

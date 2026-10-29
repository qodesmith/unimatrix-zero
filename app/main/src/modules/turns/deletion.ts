import type {Database} from '#modules/database/main'
import type {PromptRecorded, SessionCutReport} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'

import {schema} from '#modules/database/main'
import {and, eq, inArray} from 'drizzle-orm'

import {continuation, cutBelow} from './continuation'

const {prompts, replies} = schema

type ReplyRow = typeof replies.$inferSelect

/** Every Prompt from `promptId` down, and every Reply to them. */
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

/**
 * Deletes the Prompt and every Turn below it; null when the Tree doesn't have
 * it. The Reply it answers keeps where its session holds the deleted Turns,
 * so the next Prompt from it cuts them unless its Provider cuts first.
 */
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

  db.transaction(tx => {
    if (cut) {
      tx.update(replies)
        .set({sessionDropFrom: cut.session.dropFrom})
        .where(eq(replies.id, cut.replyId))
        .run()
    }

    // The Turns below go by cascade. Their Provider session data stays.
    tx.delete(prompts).where(eq(prompts.id, promptId)).run()
  })

  return {
    promptIds: deleted.promptIds,
    replyIds: deleted.replies.map(reply => reply.id),
    cut,
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

/** The Reply that the Reply's Prompt answers, and that Prompt. */
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
 * there is made. A Prompt that went into a fork leaves the session as it was.
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

  if (continued?.session?.sessionId === session.sessionId) {
    clearCut(db, prompt.parentReplyId)
  }
}

/** Only a cut session drops a Prompt, so the cut is made. */
export function clearCutOnDrop(db: Database, treeId: string, replyId: string) {
  const prompt = parentOf(db, treeId, replyId)

  if (prompt) clearCut(db, prompt.parentReplyId)
}

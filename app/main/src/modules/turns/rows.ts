import type {Database} from '#modules/database/main'
import type {ProviderId} from '@uz/contract/providers'
import type {Prompt, Reply} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {NEW_REPLY, ReplyPartSchema, RunFailureSchema} from '@uz/contract/turns'
import {and, asc, eq, isNull} from 'drizzle-orm'
import {createHash} from 'node:crypto'
import {z} from 'zod'

const {prompts, replies, systemPrompts} = schema

const ContentSchema = z.array(ReplyPartSchema)

const FailureSchema = RunFailureSchema.nullable()

type PromptRow = typeof schema.prompts.$inferSelect

type ReplyRow = typeof schema.replies.$inferSelect

function toPrompt(row: PromptRow): Prompt {
  return {
    id: row.id,
    treeId: row.treeId,
    parentReplyId: row.parentReplyId,
    text: row.text,
    createdAt: row.createdAt.toISOString(),
  }
}

function toReply(row: ReplyRow): Reply {
  return {
    id: row.id,
    treeId: row.treeId,
    promptId: row.promptId,
    provider: row.provider,
    model: row.model,
    status: row.status,
    content: ContentSchema.parse(row.content),
    contextSize: row.contextSize,
    contextWindow: row.contextWindow,
    failure: FailureSchema.parse(row.failure ?? null),
    createdAt: row.createdAt.toISOString(),
  }
}

export function listTurns(db: Database, treeId: string) {
  return {
    prompts: db
      .select()
      .from(prompts)
      .where(eq(prompts.treeId, treeId))
      .orderBy(asc(prompts.createdAt), asc(prompts.id))
      .all()
      .map(toPrompt),
    replies: db
      .select()
      .from(replies)
      .where(eq(replies.treeId, treeId))
      .orderBy(asc(replies.createdAt), asc(replies.id))
      .all()
      .map(toReply),
  }
}

export function savedReply(db: Database, replyId: string): Reply {
  const row = db.select().from(replies).where(eq(replies.id, replyId)).get()

  if (!row) throw new Error('That Reply was not saved.')

  return toReply(row)
}

function saveSystemPrompt(db: Database, text: string) {
  const hash = createHash('sha256').update(text).digest('hex')

  db.insert(systemPrompts).values({hash, text}).onConflictDoNothing().run()

  const row = db
    .select({id: systemPrompts.id})
    .from(systemPrompts)
    .where(eq(systemPrompts.hash, hash))
    .get()

  if (!row) throw new Error('The System prompt was not saved.')

  return row.id
}

export interface NewExchange {
  treeId: string
  /** The Reply it answers; null for the root Prompt. */
  parentReplyId: string | null
  text: string
  provider: ProviderId
  model: string
  systemPrompt: string
  now: Date
}

/** The Prompt and its Reply, streaming, saved together. */
export function insertExchange(
  db: Database,
  next: NewExchange
): {prompt: Prompt; reply: Reply} {
  const systemPromptId = saveSystemPrompt(db, next.systemPrompt)
  const {treeId, parentReplyId} = next

  return db.transaction(tx => {
    const root =
      parentReplyId === null &&
      tx
        .select({id: prompts.id})
        .from(prompts)
        .where(and(eq(prompts.treeId, treeId), isNull(prompts.parentReplyId)))
        .get()

    if (root) throw new Error('This Tree already has its first Prompt.')

    const prompt = tx
      .insert(prompts)
      .values({treeId, parentReplyId, text: next.text, createdAt: next.now})
      .returning()
      .get()

    const reply = tx
      .insert(replies)
      .values({
        treeId,
        promptId: prompt.id,
        provider: next.provider,
        model: next.model,
        ...NEW_REPLY,
        systemPromptId,
        createdAt: next.now,
      })
      .returning()
      .get()

    return {prompt: toPrompt(prompt), reply: toReply(reply)}
  })
}

/**
 * Back to streaming from nothing. Its Prompt stays recorded until the Provider
 * drops it, since a Retry that fails first still has to cut there.
 */
export function resetReply(db: Database, replyId: string): void {
  const row = db
    .update(replies)
    .set({...NEW_REPLY, sessionMessageId: null})
    .where(eq(replies.id, replyId))
    .returning()
    .get()

  if (!row) throw new Error('That Reply was not saved.')
}

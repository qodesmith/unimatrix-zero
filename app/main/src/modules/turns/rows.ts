import type {Database} from '#modules/database/main'
import type {Removal} from './deletion'
import type {Attachment} from '@uz/contract/attachments'
import type {ApprovalGrant} from '@uz/contract/permissions'
import type {ModelChoice, ProviderId} from '@uz/contract/providers'
import type {TreeTools} from '@uz/contract/tools'
import type {Prompt, Reply} from '@uz/contract/turns'
import type {SQL} from 'drizzle-orm'

import {attachToPrompt, attachmentsOf} from '#modules/attachments/main'
import {schema} from '#modules/database/main'
import {ApprovalGrantSchema} from '@uz/contract/permissions'
import {NEW_REPLY, ReplyPartSchema, RunFailureSchema} from '@uz/contract/turns'
import {and, asc, desc, eq, isNull} from 'drizzle-orm'
import {z} from 'zod'

import {removeTurns} from './deletion'

const {compactions, prompts, replies, systemPrompts, trees} = schema

const {compacted: _, ...NEW_REPLY_ROW} = NEW_REPLY

const ContentSchema = z.array(ReplyPartSchema)

const FailureSchema = RunFailureSchema.nullable()

const GrantsSchema = z.array(ApprovalGrantSchema)

type PromptRow = typeof schema.prompts.$inferSelect

type ReplyRow = typeof schema.replies.$inferSelect

function toPrompt(row: PromptRow, attachments: Attachment[]): Prompt {
  return {
    id: row.id,
    treeId: row.treeId,
    parentReplyId: row.parentReplyId,
    text: row.text,
    attachments,
    createdAt: row.createdAt.toISOString(),
  }
}

function toReply(row: ReplyRow, compacted: boolean): Reply {
  return {
    id: row.id,
    treeId: row.treeId,
    promptId: row.promptId,
    provider: row.provider,
    model: row.model,
    systemPromptId: row.systemPromptId,
    status: row.status,
    content: ContentSchema.parse(row.content),
    contextSize: row.contextSize,
    contextWindow: row.contextWindow,
    failure: FailureSchema.parse(row.failure ?? null),
    compacted,
    rebuilt: row.rebuilt,
    files: [],
    createdAt: row.createdAt.toISOString(),
  }
}

function repliesWhere(db: Database, matches: SQL): Reply[] {
  const compacted = new Set(
    db
      .selectDistinct({replyId: compactions.replyId})
      .from(compactions)
      .innerJoin(replies, eq(replies.id, compactions.replyId))
      .where(matches)
      .all()
      .map(row => row.replyId)
  )

  return db
    .select()
    .from(replies)
    .where(matches)
    .orderBy(asc(replies.createdAt), asc(replies.id))
    .all()
    .map(row => toReply(row, compacted.has(row.id)))
}

export function listTurns(db: Database, treeId: string) {
  const rows = db
    .select()
    .from(prompts)
    .where(eq(prompts.treeId, treeId))
    .orderBy(asc(prompts.createdAt), asc(prompts.id))
    .all()

  const attached = attachmentsOf(
    db,
    rows.map(row => row.id)
  )

  return {
    prompts: rows.map(row => toPrompt(row, attached.get(row.id) ?? [])),
    replies: repliesWhere(db, eq(replies.treeId, treeId)),
  }
}

export function lastModel(db: Database): ModelChoice | null {
  const row = db
    .select({provider: replies.provider, model: replies.model})
    .from(replies)
    .orderBy(desc(replies.createdAt), desc(replies.id))
    .limit(1)
    .get()

  return row ?? null
}

export function savedReply(db: Database, replyId: string): Reply {
  const [reply] = repliesWhere(db, eq(replies.id, replyId))

  if (!reply) throw new Error('That Reply was not saved.')

  return reply
}

/**
 * The System prompt a Provider session started under, as its first Reply ran
 * under it; null when no Reply names the session.
 */
export function startedUnder(
  db: Database,
  provider: ProviderId,
  sessionId: string
): string | null {
  const row = db
    .select({systemPromptId: replies.systemPromptId})
    .from(replies)
    .where(
      and(eq(replies.provider, provider), eq(replies.sessionId, sessionId))
    )
    .orderBy(asc(replies.createdAt), asc(replies.id))
    .limit(1)
    .get()

  return row?.systemPromptId ?? null
}

export function treeSystemPrompt(db: Database, treeId: string) {
  const row = db
    .select({id: systemPrompts.id, text: systemPrompts.text})
    .from(trees)
    .innerJoin(systemPrompts, eq(systemPrompts.id, trees.systemPromptId))
    .where(eq(trees.id, treeId))
    .get()

  if (!row) throw new Error('That Tree no longer exists.')

  return row
}

export function treeTools(db: Database, treeId: string): TreeTools {
  const row = db
    .select({
      webSearch: trees.webSearch,
      claudeConnectors: trees.claudeConnectors,
      claudeBuiltInSkills: trees.claudeBuiltInSkills,
      chatgptBuiltInSkills: trees.chatgptBuiltInSkills,
      chatgptRemotePlugins: trees.chatgptRemotePlugins,
    })
    .from(trees)
    .where(eq(trees.id, treeId))
    .get()

  if (!row) throw new Error('That Tree no longer exists.')

  return row
}

export function treeGrants(db: Database, treeId: string): ApprovalGrant[] {
  const row = db
    .select({grants: trees.approvalGrants})
    .from(trees)
    .where(eq(trees.id, treeId))
    .get()

  if (!row) throw new Error('That Tree no longer exists.')

  return GrantsSchema.parse(row.grants)
}

export function saveGrants(
  db: Database,
  treeId: string,
  grants: ApprovalGrant[]
) {
  db.update(trees)
    .set({approvalGrants: grants})
    .where(eq(trees.id, treeId))
    .run()
}

export interface NewExchange {
  treeId: string
  parentReplyId: string | null
  text: string
  attachmentIds: string[]
  provider: ProviderId
  model: string
  systemPromptId: string
  now: Date
  replacing: Removal | null
}

export function insertExchange(
  db: Database,
  next: NewExchange
): {prompt: Prompt; reply: Reply} {
  const {treeId, parentReplyId, systemPromptId} = next

  return db.transaction(tx => {
    if (next.replacing) removeTurns(tx, next.replacing)

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

    attachToPrompt(tx, prompt.id, next.attachmentIds)

    const reply = tx
      .insert(replies)
      .values({
        treeId,
        promptId: prompt.id,
        provider: next.provider,
        model: next.model,
        ...NEW_REPLY_ROW,
        systemPromptId,
        createdAt: next.now,
      })
      .returning()
      .get()

    return {
      prompt: toPrompt(
        prompt,
        attachmentsOf(tx, [prompt.id]).get(prompt.id) ?? []
      ),
      reply: toReply(reply, false),
    }
  })
}

/**
 * Keeps `sessionPromptId` until the Provider drops it: a Retry that fails first
 * still has to cut there.
 */
export function resetReply(db: Database, replyId: string): void {
  db.transaction(tx => {
    tx.update(compactions)
      .set({replyId: null})
      .where(eq(compactions.replyId, replyId))
      .run()

    const row = tx
      .update(replies)
      .set({
        ...NEW_REPLY_ROW,
        sessionMessageId: null,
        snapshotCommit: null,
        noSnapshot: null,
      })
      .where(eq(replies.id, replyId))
      .returning()
      .get()

    if (!row) throw new Error('That Reply was not saved.')
  })
}

import type {Database} from '#modules/database/main'
import type {AppEvent} from '@uz/contract/events'
import type {ReplyRecorded} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {
  Prompt,
  Reply,
  ReplyEvent,
  ReplyProgress,
  RunFailure,
  StreamingReply,
} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {
  NEW_REPLY,
  ReplyPartSchema,
  RunFailureSchema,
  foldReplyEvent,
} from '@uz/contract/turns'
import {and, asc, eq, isNull} from 'drizzle-orm'
import {createHash} from 'node:crypto'
import {z} from 'zod'

import {continuation, recovery} from './continuation'

export const PARTIAL_SAVE_MS = 1000

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

/** Parts before the last are done; the last is done once a tool answers it. */
function finishedParts({content}: ReplyProgress) {
  const last = content.at(-1)
  const lastDone = last?.type === 'tool-call' && last.result !== null

  return Math.max(content.length - 1, 0) + (lastDone ? 1 : 0)
}

interface InFlight {
  provider: ProviderId
  reply: StreamingReply
  saveTimer: ReturnType<typeof setTimeout> | null
}

interface NewPrompt {
  treeId: string
  /** The Reply it answers; null for the root Prompt. */
  parentReplyId: string | null
  text: string
  provider: ProviderId
  model: string
  systemPrompt: string
  now: Date
}

export type Turns = ReturnType<typeof createTurns>

/**
 * A streaming Reply is saved before it is published, so a window never shows
 * what main has not saved or is not about to save. Nothing streams before this
 * runs, so a Reply still `streaming` was left by the last quit: it becomes
 * `interrupted` here, once per launch.
 */
export function createTurns(db: Database, publish: (event: AppEvent) => void) {
  const {prompts, replies, systemPrompts} = schema
  const inFlight = new Map<string, InFlight>()

  db.update(replies)
    .set({status: 'interrupted'})
    .where(eq(replies.status, 'streaming'))
    .run()

  function save(entry: InFlight) {
    if (entry.saveTimer) clearTimeout(entry.saveTimer)
    entry.saveTimer = null

    const {status, content, contextSize, contextWindow, failure} = entry.reply
    db.update(replies)
      .set({status, content, contextSize, contextWindow, failure})
      .where(eq(replies.id, entry.reply.replyId))
      .run()
  }

  function saveSoon(entry: InFlight) {
    entry.saveTimer ??= setTimeout(() => save(entry), PARTIAL_SAVE_MS)
  }

  function apply(provider: ProviderId, event: ReplyEvent) {
    const entry = inFlight.get(event.replyId)

    if (entry?.provider !== provider || entry.reply.treeId !== event.treeId) {
      return
    }

    const before = entry.reply
    entry.reply = foldReplyEvent(before, event)

    if (event.type === 'RUN_FINISHED') {
      inFlight.delete(event.replyId)
      save(entry)
    } else if (finishedParts(entry.reply) > finishedParts(before)) {
      save(entry)
    } else if (entry.reply !== before) {
      saveSoon(entry)
    }

    publish(event)
  }

  function fail(entry: InFlight, failure: RunFailure) {
    const {treeId, replyId} = entry.reply

    apply(entry.provider, {
      type: 'RUN_FINISHED',
      treeId,
      replyId,
      status: 'failed',
      failure,
    })
  }

  function record(provider: ProviderId, recorded: ReplyRecorded) {
    const {treeId, replyId, model, session} = recorded

    db.update(replies)
      .set({
        model,
        sessionId: session.sessionId,
        sessionMessageId: session.messageId,
      })
      .where(
        and(
          eq(replies.id, replyId),
          eq(replies.treeId, treeId),
          eq(replies.provider, provider)
        )
      )
      .run()
  }

  function saveSystemPrompt(text: string) {
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

  return {
    list(treeId: string) {
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
    },

    continuation: (treeId: string, replyId: string) =>
      continuation(db, treeId, replyId),

    recovery: (treeId: string, replyId: string) =>
      recovery(db, treeId, replyId),

    /** Resets the Reply in place; its Provider host is asked for it separately. */
    restart(replyId: string): Reply {
      const row = db
        .update(replies)
        .set({...NEW_REPLY, sessionId: null, sessionMessageId: null})
        .where(eq(replies.id, replyId))
        .returning()
        .get()

      if (!row) throw new Error('That Reply was not saved.')

      inFlight.set(replyId, {
        provider: row.provider,
        reply: {...NEW_REPLY, treeId: row.treeId, replyId},
        saveTimer: null,
      })

      return toReply(row)
    },

    writer(treeId: string, replyId: string): ProviderId {
      const entry = inFlight.get(replyId)

      if (!entry || entry.reply.treeId !== treeId) {
        throw new Error('That Reply isn’t being written.')
      }

      return entry.provider
    },

    start(next: NewPrompt): {prompt: Prompt; reply: Reply} {
      const systemPromptId = saveSystemPrompt(next.systemPrompt)
      const {treeId, parentReplyId} = next

      const saved = db.transaction(tx => {
        const root =
          parentReplyId === null &&
          tx
            .select({id: prompts.id})
            .from(prompts)
            .where(
              and(eq(prompts.treeId, treeId), isNull(prompts.parentReplyId))
            )
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

      inFlight.set(saved.reply.id, {
        provider: next.provider,
        reply: {...NEW_REPLY, treeId, replyId: saved.reply.id},
        saveTimer: null,
      })

      return saved
    },

    apply,

    record,

    fail(replyId: string, failure: RunFailure): Reply {
      const entry = inFlight.get(replyId)

      if (entry) fail(entry, failure)

      const row = db.select().from(replies).where(eq(replies.id, replyId)).get()

      if (!row) throw new Error('That Reply was not saved.')

      return toReply(row)
    },

    failAll(provider: ProviderId, failure: RunFailure) {
      for (const entry of inFlight.values()) {
        if (entry.provider === provider) fail(entry, failure)
      }
    },

    /** Saves any partial text still waiting on its timer, before quitting. */
    saveAll() {
      for (const entry of inFlight.values()) {
        if (entry.saveTimer) save(entry)
      }
    },

    streaming(): StreamingReply[] {
      return [...inFlight.values()].map(entry => entry.reply)
    },
  }
}

import type {Database} from '#modules/database/main'
import type {AppEvent} from '@uz/contract/events'
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
import {NEW_REPLY, ReplyPartSchema, foldReplyEvent} from '@uz/contract/turns'
import {and, asc, eq, isNull} from 'drizzle-orm'
import {createHash} from 'node:crypto'
import {z} from 'zod'

/** How long partial text may go unsaved while a Reply streams. */
export const PARTIAL_SAVE_MS = 1000

const ContentSchema = z.array(ReplyPartSchema)

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

interface RootPrompt {
  treeId: string
  text: string
  provider: ProviderId
  model: string
  systemPrompt: string
  now: Date
}

export type Turns = ReturnType<typeof createTurns>

/**
 * Prompts and Replies. A streaming Reply is folded here, saved, and only then
 * published, so a window never shows what main has not saved or is not about
 * to save: the row at start, at each finished part, at most a second behind
 * for partial text, and at the end.
 */
export function createTurns(db: Database, publish: (event: AppEvent) => void) {
  const {prompts, replies, systemPrompts} = schema
  const inFlight = new Map<string, InFlight>()

  function save(entry: InFlight) {
    if (entry.saveTimer) clearTimeout(entry.saveTimer)
    entry.saveTimer = null

    const {status, content, contextSize} = entry.reply
    db.update(replies)
      .set({status, content, contextSize})
      .where(eq(replies.id, entry.reply.replyId))
      .run()
  }

  function saveSoon(entry: InFlight) {
    entry.saveTimer ??= setTimeout(() => save(entry), PARTIAL_SAVE_MS)
  }

  /**
   * Folds an event from a Provider host into its Reply, saves when due, then
   * publishes it. Events for a Reply that host isn't writing are dropped.
   */
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

  /** Saves and publishes the Reply as failed, with the text it last showed. */
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

  /** The System prompt's id, saving it first if no Reply has used it. */
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

    /** Saves the root Prompt and its Reply, which starts out streaming. */
    startRoot(root: RootPrompt): {prompt: Prompt; reply: Reply} {
      const systemPromptId = saveSystemPrompt(root.systemPrompt)

      const saved = db.transaction(tx => {
        const existing = tx
          .select({id: prompts.id})
          .from(prompts)
          .where(
            and(eq(prompts.treeId, root.treeId), isNull(prompts.parentReplyId))
          )
          .get()

        if (existing) {
          throw new Error('This Tree already has its first Prompt.')
        }

        const prompt = tx
          .insert(prompts)
          .values({treeId: root.treeId, text: root.text, createdAt: root.now})
          .returning()
          .get()

        const reply = tx
          .insert(replies)
          .values({
            treeId: root.treeId,
            promptId: prompt.id,
            provider: root.provider,
            model: root.model,
            ...NEW_REPLY,
            systemPromptId,
            createdAt: root.now,
          })
          .returning()
          .get()

        return {prompt: toPrompt(prompt), reply: toReply(reply)}
      })

      inFlight.set(saved.reply.id, {
        provider: root.provider,
        reply: {...NEW_REPLY, treeId: root.treeId, replyId: saved.reply.id},
        saveTimer: null,
      })

      return saved
    },

    apply,

    /** Fails one streaming Reply and returns it as saved. */
    fail(replyId: string, failure: RunFailure): Reply {
      const entry = inFlight.get(replyId)

      if (entry) fail(entry, failure)

      const row = db.select().from(replies).where(eq(replies.id, replyId)).get()

      if (!row) throw new Error('That Reply was not saved.')

      return toReply(row)
    },

    /**
     * The host for this Provider is gone: each of its Replies is saved as
     * failed with the text it last showed. Nothing is re-run.
     */
    failAll(provider: ProviderId, failure: RunFailure) {
      for (const entry of inFlight.values()) {
        if (entry.provider === provider) fail(entry, failure)
      }
    },

    /** Every Reply being written, as last published. */
    streaming(): StreamingReply[] {
      return [...inFlight.values()].map(entry => entry.reply)
    },
  }
}

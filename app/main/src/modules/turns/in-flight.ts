import type {Database} from '#modules/database/main'
import type {AppEvent} from '@uz/contract/events'
import type {
  PromptDropped,
  PromptRecorded,
  ReplyRecorded,
} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {
  ReplyEvent,
  ReplyProgress,
  RunFailure,
  StreamingReply,
} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {and, eq} from 'drizzle-orm'

export const PARTIAL_SAVE_MS = 1000

const {replies} = schema

/** Parts before the last are done; the last is done once a tool answers it. */
function finishedParts({content}: ReplyProgress) {
  const last = content.at(-1)
  const lastDone = last?.type === 'tool-call' && last.result !== null

  return Math.max(content.length - 1, 0) + (lastDone ? 1 : 0)
}

function providersReply(provider: ProviderId, treeId: string, replyId: string) {
  return and(
    eq(replies.id, replyId),
    eq(replies.treeId, treeId),
    eq(replies.provider, provider)
  )
}

interface Entry {
  provider: ProviderId
  reply: StreamingReply
  saveTimer: ReturnType<typeof setTimeout> | null
}

/**
 * The Replies a host is writing. A streaming Reply is saved before it is
 * published, so a window never shows what main has not saved or is not about
 * to save.
 */
export function createInFlight(
  db: Database,
  publish: (event: AppEvent) => void
) {
  const entries = new Map<string, Entry>()

  function save(entry: Entry) {
    if (entry.saveTimer) clearTimeout(entry.saveTimer)
    entry.saveTimer = null

    const {status, content, contextSize, contextWindow, failure} = entry.reply
    db.update(replies)
      .set({status, content, contextSize, contextWindow, failure})
      .where(eq(replies.id, entry.reply.replyId))
      .run()
  }

  function saveSoon(entry: Entry) {
    entry.saveTimer ??= setTimeout(() => save(entry), PARTIAL_SAVE_MS)
  }

  function apply(provider: ProviderId, event: ReplyEvent) {
    const entry = entries.get(event.replyId)

    if (entry?.provider !== provider || entry.reply.treeId !== event.treeId) {
      return
    }

    const before = entry.reply
    entry.reply = foldReplyEvent(before, event)

    if (event.type === 'RUN_FINISHED') {
      entries.delete(event.replyId)
      save(entry)
    } else if (finishedParts(entry.reply) > finishedParts(before)) {
      save(entry)
    } else if (entry.reply !== before) {
      saveSoon(entry)
    }

    publish(event)
  }

  function fail(entry: Entry, failure: RunFailure) {
    const {treeId, replyId} = entry.reply

    apply(entry.provider, {
      type: 'RUN_FINISHED',
      treeId,
      replyId,
      status: 'failed',
      failure,
    })
  }

  return {
    track(provider: ProviderId, treeId: string, replyId: string) {
      entries.set(replyId, {
        provider,
        reply: {...NEW_REPLY, treeId, replyId},
        saveTimer: null,
      })
    },

    apply,

    recordPrompt(provider: ProviderId, recorded: PromptRecorded) {
      const {treeId, replyId, session} = recorded

      db.update(replies)
        .set({sessionId: session.sessionId, sessionPromptId: session.messageId})
        .where(providersReply(provider, treeId, replyId))
        .run()
    },

    dropPrompt(provider: ProviderId, {treeId, replyId}: PromptDropped) {
      db.update(replies)
        .set({sessionPromptId: null})
        .where(providersReply(provider, treeId, replyId))
        .run()
    },

    record(provider: ProviderId, recorded: ReplyRecorded) {
      const {treeId, replyId, model, session} = recorded

      db.update(replies)
        .set({
          model,
          sessionId: session.sessionId,
          sessionMessageId: session.messageId,
        })
        .where(providersReply(provider, treeId, replyId))
        .run()
    },

    /** The Provider writing the Reply, or null when none is. */
    writer(treeId: string, replyId: string): ProviderId | null {
      const entry = entries.get(replyId)

      return entry?.reply.treeId === treeId ? entry.provider : null
    },

    fail(replyId: string, failure: RunFailure) {
      const entry = entries.get(replyId)

      if (entry) fail(entry, failure)
    },

    failAll(provider: ProviderId, failure: RunFailure) {
      for (const entry of entries.values()) {
        if (entry.provider === provider) fail(entry, failure)
      }
    },

    /** Saves any partial text still waiting on its timer. */
    saveAll() {
      for (const entry of entries.values()) {
        if (entry.saveTimer) save(entry)
      }
    },

    streaming(): StreamingReply[] {
      return [...entries.values()].map(entry => entry.reply)
    },
  }
}

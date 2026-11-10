import type {Database} from '#modules/database/main'
import type {AppEvent} from '@uz/contract/events'
import type {
  PromptDropped,
  PromptRecorded,
  ReplyRecorded,
  ReplyRequest,
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

const {compactions, replies} = schema

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

export interface FinishedReply {
  provider: ProviderId
  treeId: string
  replyId: string
  status: Extract<ReplyEvent, {type: 'RUN_FINISHED'}>['status']
  /** As the Reply's row records it. */
  model: string
  failure: RunFailure | null
}

interface Entry {
  provider: ProviderId
  /** The Model asked for, until its Provider reports the one it used. */
  model: string
  /** The id main asked the Provider to store the Prompt under. */
  promptMessageId: string
  reply: StreamingReply
  saveTimer: ReturnType<typeof setTimeout> | null
}

/**
 * A streaming Reply is saved before it is published, so a window never shows
 * what main has not saved or is not about to save.
 */
export function createInFlight(
  db: Database,
  publish: (event: AppEvent) => void,
  onFinished: (finished: FinishedReply) => void
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

  /** A Subagent compacts its own transcript, not the session's: no record. */
  function recordCompaction(
    entry: Entry,
    event: Extract<ReplyEvent, {type: 'CONTEXT_COMPACTED'}>
  ) {
    if (event.subagentId !== undefined) return

    const {sessionId, boundaryId, replyId} = event
    db.insert(compactions)
      .values({provider: entry.provider, sessionId, boundaryId, replyId})
      .run()
  }

  function advance(entry: Entry, event: ReplyEvent) {
    const before = entry.reply
    entry.reply = foldReplyEvent(before, event)

    if (event.type === 'CONTEXT_COMPACTED') recordCompaction(entry, event)

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

  function apply(provider: ProviderId, event: ReplyEvent) {
    const entry = entries.get(event.replyId)

    if (entry?.provider !== provider || entry.reply.treeId !== event.treeId) {
      return
    }

    advance(entry, event)

    if (event.type === 'RUN_FINISHED') {
      const {treeId, replyId, status} = event
      const {model, reply} = entry
      onFinished({
        provider,
        treeId,
        replyId,
        status,
        model,
        failure: reply.failure,
      })
    }
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
    track(
      provider: ProviderId,
      {treeId, replyId, model, prompt}: ReplyRequest
    ) {
      entries.set(replyId, {
        provider,
        model,
        promptMessageId: prompt.messageId,
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

    replyPromptedBy(uuids: string[]) {
      const entry = [...entries.values()].find(one =>
        uuids.includes(one.promptMessageId)
      )

      return entry
        ? {
            treeId: entry.reply.treeId,
            replyId: entry.reply.replyId,
            messageId: entry.promptMessageId,
          }
        : null
    },

    dropPrompt(provider: ProviderId, {treeId, replyId}: PromptDropped) {
      db.update(replies)
        .set({sessionPromptId: null})
        .where(providersReply(provider, treeId, replyId))
        .run()
    },

    record(provider: ProviderId, recorded: ReplyRecorded) {
      const {treeId, replyId, model, session} = recorded
      const entry = entries.get(replyId)

      if (entry?.provider === provider && entry.reply.treeId === treeId) {
        entry.model = model
      }

      db.update(replies)
        .set({
          model,
          sessionId: session.sessionId,
          sessionMessageId: session.messageId,
        })
        .where(providersReply(provider, treeId, replyId))
        .run()
    },

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

    saveAll() {
      for (const entry of entries.values()) {
        if (entry.saveTimer) save(entry)
      }
    },

    /**
     * Stops the Tree's Replies without their hosts and returns them. Windows
     * hear each end, but `onFinished` does not: the Tree is being deleted.
     */
    endIn(treeId: string): {provider: ProviderId; replyId: string}[] {
      const ending = [...entries.values()].filter(
        entry => entry.reply.treeId === treeId
      )

      for (const entry of ending) {
        const {replyId} = entry.reply
        advance(entry, {
          type: 'RUN_FINISHED',
          treeId,
          replyId,
          status: 'stopped',
        })
      }

      return ending.map(({provider, reply}) => ({
        provider,
        replyId: reply.replyId,
      }))
    },

    streaming(): StreamingReply[] {
      return [...entries.values()].map(entry => entry.reply)
    },
  }
}

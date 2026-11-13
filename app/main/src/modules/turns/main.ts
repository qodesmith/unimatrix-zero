import type {Database} from '#modules/database/main'
import type {Continuation} from './continuation'
import type {FinishedReply} from './in-flight'
import type {ListedModels} from './thread'
import type {Command, CommandResult} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {
  HostCommand,
  PromptDropped,
  PromptRecorded,
  ReplyRecorded,
  ReplyRequest,
  SessionCutReport,
  SignInRequest,
} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {CompactionSettings} from '@uz/contract/settings'
import type {Reply, ReplyEvent} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {PROVIDER_NAMES} from '@uz/contract/providers'
import {eq} from 'drizzle-orm'
import {randomUUID} from 'node:crypto'

import {continuation, recovery} from './continuation'
import {
  clearCutOnDrop,
  clearCutOnPrompt,
  clearCutOnReport,
  deleteBelow,
  failedToReplace,
} from './deletion'
import {createInFlight} from './in-flight'
import {
  insertExchange,
  lastModel,
  listTurns,
  resetReply,
  savedReply,
} from './rows'
import {explainingLabels, threadTo} from './thread'

export {PARTIAL_SAVE_MS} from './in-flight'

export type {FinishedReply} from './in-flight'

export interface ReplyHosts {
  ready(provider: ProviderId): boolean
  /** Throws when the host can't be reached. */
  send(provider: ProviderId, command: HostCommand): void
}

export interface TurnsDeps {
  db: Database
  publish: (event: AppEvent) => void
  hosts: ReplyHosts
  vendorProgramFor: (provider: ProviderId) => SignInRequest
  /** Read as each Reply starts, so a change applies from the next one. */
  compactionSettingsFor: (provider: ProviderId) => CompactionSettings
  /** For telling the AI which Replies another Model wrote, and its name. */
  listedModels: ListedModels
  now: () => Date
  onTurnsChanged: (treeId: string) => void
  /** Every way a Reply ends, a failure to reach its host included. */
  onReplyFinished: (finished: FinishedReply) => void
}

export type NewPrompt = Omit<Extract<Command, {type: 'prompt.send'}>, 'type'>

export type Turns = ReturnType<typeof createTurns>

/**
 * Create once per launch, before any host starts: a Reply still `streaming` was
 * left by the last quit, and becomes `interrupted` here.
 */
export function createTurns({
  db,
  publish,
  hosts,
  vendorProgramFor,
  compactionSettingsFor,
  listedModels,
  now,
  onTurnsChanged,
  onReplyFinished,
}: TurnsDeps) {
  const inFlight = createInFlight(db, publish, onReplyFinished)

  db.update(schema.replies)
    .set({status: 'interrupted'})
    .where(eq(schema.replies.status, 'streaming'))
    .run()

  function startOnHost(provider: ProviderId, request: ReplyRequest): Reply {
    inFlight.track(provider, request)

    try {
      hosts.send(provider, {type: 'reply.start', request})
    } catch {
      inFlight.fail(request.replyId, {
        code: 'host-unreachable',
        message: `${PROVIDER_NAMES[provider]} could not be reached.`,
      })
    }

    return savedReply(db, request.replyId)
  }

  function promptRecorded(provider: ProviderId, recorded: PromptRecorded) {
    inFlight.recordPrompt(provider, recorded)
    clearCutOnPrompt(db, recorded)
  }

  /**
   * A failed attempt on the Prompt's Provider may have left its Prompt in the
   * session, so the session is the one its Retry would resume. A Provider the
   * Reply being answered isn't on has no session of the Thread.
   */
  function sessionOn(
    provider: ProviderId,
    {treeId, parentReplyId}: Pick<NewPrompt, 'treeId' | 'parentReplyId'>,
    failed: ReturnType<typeof failedToReplace>
  ) {
    if (failed?.provider === provider) return failed.session

    const continued =
      parentReplyId === null
        ? null
        : continuation(db, treeId, parentReplyId, failed?.promptId)

    return continued?.provider === provider ? continued.session : null
  }

  function refuseUnsendable(
    continued: Continuation | null,
    provider: ProviderId
  ) {
    if (!hosts.ready(provider)) {
      throw new Error(
        continued
          ? `Connect ${PROVIDER_NAMES[provider]} to continue this Thread.`
          : 'Connect a Provider to send a Prompt.'
      )
    }
  }

  return {
    list: (treeId: string) => listTurns(db, treeId),

    streaming: () => inFlight.streaming(),

    lastModel: () => lastModel(db),

    /** Null when the Reply it answers is gone. */
    sendPrompt({
      treeId,
      parentReplyId,
      text,
      model: picked,
    }: NewPrompt): CommandResult<'prompt.send'> | null {
      const continued =
        parentReplyId === null ? null : continuation(db, treeId, parentReplyId)

      if (parentReplyId !== null && !continued) return null

      const {provider, model} = picked

      refuseUnsendable(continued, provider)

      const failed = failedToReplace(db, treeId, parentReplyId)
      const systemPrompt = ''
      const thread = threadTo(db, treeId, parentReplyId, picked, listedModels)
      // Before the Prompt is saved: once it is, the Reply it answers has a
      // Prompt after it, and its session would fork.
      const session = sessionOn(provider, {treeId, parentReplyId}, failed)

      const {prompt, reply} = insertExchange(db, {
        treeId,
        parentReplyId,
        text,
        provider,
        model,
        systemPrompt,
        now: now(),
        replacing: failed,
      })

      const started = startOnHost(provider, {
        treeId,
        replyId: reply.id,
        model,
        systemPrompt: explainingLabels(systemPrompt, thread),
        prompt: {text, messageId: randomUUID()},
        vendorProgram: vendorProgramFor(provider),
        session,
        thread,
        compactionSettings: compactionSettingsFor(provider),
      })

      onTurnsChanged(treeId)
      publish({type: 'LAST_MODEL_CHANGED', model: picked})

      return {
        prompt,
        reply: started,
        removed: {
          promptIds: failed?.promptIds ?? [],
          replyIds: failed?.replyIds ?? [],
        },
      }
    },

    /** Runs a failed Reply's Prompt again in place; null when it's gone. */
    retry(treeId: string, replyId: string): Reply | null {
      const recovered = recovery(db, treeId, replyId)

      if (!recovered) return null

      const {provider, model, systemPrompt, text, session} = recovered

      if (!hosts.ready(provider)) {
        throw new Error(`Connect ${PROVIDER_NAMES[provider]} to retry.`)
      }

      const thread = threadTo(
        db,
        treeId,
        recovered.parentReplyId,
        {provider, model},
        listedModels
      )

      resetReply(db, replyId)

      return startOnHost(provider, {
        treeId,
        replyId,
        model,
        systemPrompt: explainingLabels(systemPrompt, thread),
        prompt: {text, messageId: randomUUID()},
        vendorProgram: vendorProgramFor(provider),
        session,
        thread,
        compactionSettings: compactionSettingsFor(provider),
      })
    },

    /** Its `RUN_FINISHED` comes from the host. */
    stop(treeId: string, replyId: string) {
      const provider = inFlight.writer(treeId, replyId)

      if (!provider) throw new Error('That Reply isn’t being written.')

      hosts.send(provider, {type: 'reply.stop', replyId})
    },

    /** For deleting the Tree: anything its hosts send after this is dropped. */
    stopAll(treeId: string) {
      for (const {provider, replyId} of inFlight.endIn(treeId)) {
        try {
          hosts.send(provider, {type: 'reply.stop', replyId})
        } catch {
          // A host that can't be reached writes nothing more.
        }
      }
    },

    hostEvent: (provider: ProviderId, event: ReplyEvent) =>
      inFlight.apply(provider, event),

    /**
     * Refused while a Reply below streams. A Provider that can't cut now
     * cuts with the next Prompt from the Reply the deleted Prompt answers.
     */
    deletePrompt(
      treeId: string,
      promptId: string
    ): CommandResult<'prompt.delete'> | null {
      const deleted = deleteBelow(db, treeId, promptId)

      if (!deleted) return null

      const {promptIds, replyIds, cut} = deleted

      if (cut && hosts.ready(cut.provider)) {
        try {
          hosts.send(cut.provider, {
            type: 'session.cut',
            treeId,
            replyId: cut.replyId,
            session: cut.session,
            vendorProgram: vendorProgramFor(cut.provider),
          })
        } catch {
          // The next Prompt from that Reply cuts instead.
        }
      }

      onTurnsChanged(treeId)

      return {promptIds, replyIds}
    },

    hostPromptRecorded: promptRecorded,

    /**
     * Records a Prompt sent under main's id in the step that stores it, so a
     * quit never leaves its Reply naming a Prompt from the attempt before.
     */
    hostSessionAppended(
      provider: ProviderId,
      sessionId: string,
      uuids: string[]
    ) {
      const prompt = inFlight.replyPromptedBy(uuids)

      if (!prompt) return

      const {treeId, replyId, messageId} = prompt
      promptRecorded(provider, {
        type: 'PROMPT_RECORDED',
        treeId,
        replyId,
        session: {sessionId, messageId},
      })
    },

    hostPromptDropped(provider: ProviderId, dropped: PromptDropped) {
      inFlight.dropPrompt(provider, dropped)
      clearCutOnDrop(db, dropped.treeId, dropped.replyId)
    },

    hostSessionCut: (provider: ProviderId, cut: SessionCutReport) =>
      clearCutOnReport(db, provider, cut),

    hostRecorded: (provider: ProviderId, recorded: ReplyRecorded) =>
      inFlight.record(provider, recorded),

    hostCrashed(provider: ProviderId) {
      inFlight.failAll(provider, {
        code: 'host-crashed',
        message: `${PROVIDER_NAMES[provider]} stopped unexpectedly.`,
      })
    },

    /** Saves partial text still waiting on its timer, after the hosts stop. */
    quitting: () => inFlight.saveAll(),
  }
}

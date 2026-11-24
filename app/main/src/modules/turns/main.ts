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

import {refuseTooManyImages} from '#modules/attachments/main'
import {schema} from '#modules/database/main'
import {withAppSections} from '#modules/tree-files/main'
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
  startedUnder,
  treeSystemPrompt,
} from './rows'
import {threadTo, withAttachments} from './thread'

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
  treeFolderFor: (treeId: string) => string
  /** A Reply waits for this, so it never writes into a Snapshot being taken. */
  snapshotsBefore: (
    treeId: string,
    parentReplyId: string | null
  ) => Promise<void> | null
  compactionSettingsFor: (provider: ProviderId) => CompactionSettings
  listedModels: ListedModels
  attachmentsDir: string
  now: () => Date
  onTurnsChanged: (treeId: string) => void
  /** Every way a Reply ends, a failure to reach its host included. */
  onReplyFinished: (finished: FinishedReply) => void
}

export type NewPrompt = Omit<Extract<Command, {type: 'prompt.send'}>, 'type'>

export type Turns = ReturnType<typeof createTurns>

/**
 * Create once per launch, before any host starts: it marks Replies the last
 * quit left `streaming` as `interrupted`.
 */
export function createTurns({
  db,
  publish,
  hosts,
  vendorProgramFor,
  treeFolderFor,
  snapshotsBefore,
  compactionSettingsFor,
  listedModels,
  attachmentsDir,
  now,
  onTurnsChanged,
  onReplyFinished,
}: TurnsDeps) {
  const inFlight = createInFlight(db, publish, onReplyFinished)

  db.update(schema.replies)
    .set({status: 'interrupted'})
    .where(eq(schema.replies.status, 'streaming'))
    .run()

  function sendToHost(provider: ProviderId, request: ReplyRequest) {
    try {
      hosts.send(provider, {type: 'reply.start', request})
    } catch {
      inFlight.fail(request.replyId, {
        code: 'host-unreachable',
        message: `${PROVIDER_NAMES[provider]} could not be reached.`,
      })
    }
  }

  /** Its Tree may be deleted while it waits; then nothing is sent. */
  async function sendAfter(
    snapshot: Promise<void>,
    provider: ProviderId,
    request: ReplyRequest
  ) {
    await snapshot

    if (inFlight.writer(request.treeId, request.replyId)) {
      sendToHost(provider, request)
    }
  }

  function startOnHost(
    provider: ProviderId,
    request: ReplyRequest,
    parentReplyId: string | null
  ): Reply {
    const snapshot = snapshotsBefore(request.treeId, parentReplyId)

    inFlight.track(provider, request)

    if (snapshot) void sendAfter(snapshot, provider, request)
    else sendToHost(provider, request)

    return savedReply(db, request.replyId)
  }

  function promptRecorded(provider: ProviderId, recorded: PromptRecorded) {
    inFlight.recordPrompt(provider, recorded)
    clearCutOnPrompt(db, recorded)
  }

  /** A failed attempt may have left its Prompt in the session, so reuse it. */
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

  /** A Codex thread keeps the System prompt it started under for good. */
  function systemPromptChanged(
    provider: ProviderId,
    session: ReplyRequest['session'],
    systemPromptId: string
  ) {
    const started = session && startedUnder(db, provider, session.sessionId)

    return started !== null && started !== systemPromptId
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
      attachmentIds = [],
      model: picked,
    }: NewPrompt): CommandResult<'prompt.send'> | null {
      const continued =
        parentReplyId === null ? null : continuation(db, treeId, parentReplyId)

      if (parentReplyId !== null && !continued) return null

      const {provider, model} = picked

      refuseUnsendable(continued, provider)
      refuseTooManyImages(db, attachmentIds)

      const failed = failedToReplace(db, treeId, parentReplyId)
      const systemPrompt = treeSystemPrompt(db, treeId)

      const walked = threadTo(db, treeId, parentReplyId, picked, listedModels)

      // Before insertExchange: once the Prompt is saved, the session forks.
      const session = sessionOn(provider, {treeId, parentReplyId}, failed)

      const treeFolder = treeFolderFor(treeId)

      const {prompt, reply} = insertExchange(db, {
        treeId,
        parentReplyId,
        text,
        attachmentIds,
        provider,
        model,
        systemPromptId: systemPrompt.id,
        now: now(),
        replacing: failed,
      })

      const {thread, attachments} = withAttachments(db, walked, {
        provider,
        promptId: prompt.id,
        attachmentsDir,
      })

      const started = startOnHost(
        provider,
        {
          treeId,
          replyId: reply.id,
          model,
          systemPrompt: withAppSections(systemPrompt.text, treeFolder),
          prompt: {text, attachments, messageId: randomUUID()},
          vendorProgram: vendorProgramFor(provider),
          treeFolder,
          session,
          thread,
          compactionSettings: compactionSettingsFor(provider),
          systemPromptChanged: systemPromptChanged(
            provider,
            session,
            systemPrompt.id
          ),
        },
        parentReplyId
      )

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

    retry(treeId: string, replyId: string): Reply | null {
      const recovered = recovery(db, treeId, replyId)

      if (!recovered) return null

      const {provider, model, systemPrompt, text, promptId, session} = recovered

      if (!hosts.ready(provider)) {
        throw new Error(`Connect ${PROVIDER_NAMES[provider]} to retry.`)
      }

      const {thread, attachments} = withAttachments(
        db,
        threadTo(
          db,
          treeId,
          recovered.parentReplyId,
          {provider, model},
          listedModels
        ),
        {provider, promptId, attachmentsDir}
      )

      const treeFolder = treeFolderFor(treeId)

      resetReply(db, replyId)

      return startOnHost(
        provider,
        {
          treeId,
          replyId,
          model,
          systemPrompt: withAppSections(systemPrompt.text, treeFolder),
          prompt: {text, attachments, messageId: randomUUID()},
          vendorProgram: vendorProgramFor(provider),
          treeFolder,
          session,
          thread,
          compactionSettings: compactionSettingsFor(provider),
          systemPromptChanged: systemPromptChanged(
            provider,
            session,
            systemPrompt.id
          ),
        },
        recovered.parentReplyId
      )
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

    /** Refused while a Reply below streams. */
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
     * Records the Prompt in the step that stores it, so a quit never leaves its
     * Reply naming the last attempt's Prompt.
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

import type {Database} from '#modules/database/main'
import type {AppEvent} from '@uz/contract/events'
import type {
  HostCommand,
  ReplyRecorded,
  ReplyRequest,
  SignInRequest,
} from '@uz/contract/host'
import type {Model, ProviderId} from '@uz/contract/providers'
import type {Prompt, Reply, ReplyEvent} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {PROVIDER_NAMES} from '@uz/contract/providers'
import {eq} from 'drizzle-orm'

import {continuation, recovery} from './continuation'
import {createInFlight} from './in-flight'
import {insertExchange, listTurns, resetReply, savedReply} from './rows'

export {PARTIAL_SAVE_MS} from './in-flight'

/** What a Reply needs of the Provider hosts. */
export interface ReplyHosts {
  /** A ready host's Provider (`only`, if given) and its default Model. */
  ready(only?: ProviderId): {provider: ProviderId; model: Model} | null
  /** Throws when the host can't be reached. */
  send(provider: ProviderId, command: HostCommand): void
}

export interface TurnsDeps {
  db: Database
  publish: (event: AppEvent) => void
  hosts: ReplyHosts
  /** The vendor program and configuration folder a Provider's Replies use. */
  vendorProgramFor: (provider: ProviderId) => SignInRequest
  now: () => Date
}

export interface NewPrompt {
  treeId: string
  /** The Reply it answers; null for the root Prompt. */
  parentReplyId: string | null
  text: string
}

export type Turns = ReturnType<typeof createTurns>

/**
 * A Tree's Prompts and Replies, and every Reply's run from its Prompt to its
 * end. Nothing streams before this runs, so a Reply still `streaming` was left
 * by the last quit: it becomes `interrupted` here, once per launch.
 */
export function createTurns({
  db,
  publish,
  hosts,
  vendorProgramFor,
  now,
}: TurnsDeps) {
  const inFlight = createInFlight(db, publish)

  db.update(schema.replies)
    .set({status: 'interrupted'})
    .where(eq(schema.replies.status, 'streaming'))
    .run()

  /** The Reply as it now stands: failed when its host can't be reached. */
  function startOnHost(provider: ProviderId, request: ReplyRequest): Reply {
    inFlight.track(provider, request.treeId, request.replyId)

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

  return {
    list: (treeId: string) => listTurns(db, treeId),

    /** For a window that connects mid-stream. */
    streaming: () => inFlight.streaming(),

    /** Null when the Reply it answers is gone. */
    sendPrompt({
      treeId,
      parentReplyId,
      text,
    }: NewPrompt): {prompt: Prompt; reply: Reply} | null {
      const continued =
        parentReplyId === null ? null : continuation(db, treeId, parentReplyId)

      if (parentReplyId !== null && !continued) return null

      const ready = hosts.ready(continued?.provider)

      if (!ready) {
        throw new Error(
          continued
            ? `Connect ${PROVIDER_NAMES[continued.provider]} to continue this Thread.`
            : 'Connect a Provider to send a Prompt.'
        )
      }

      const {provider, model} = ready
      const systemPrompt = ''

      const {prompt, reply} = insertExchange(db, {
        treeId,
        parentReplyId,
        text,
        provider,
        model: model.id,
        systemPrompt,
        now: now(),
      })

      return {
        prompt,
        reply: startOnHost(provider, {
          treeId,
          replyId: reply.id,
          model: model.id,
          systemPrompt,
          prompt: {text},
          vendorProgram: vendorProgramFor(provider),
          session: continued?.session ?? null,
        }),
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

      resetReply(db, replyId)

      return startOnHost(provider, {
        treeId,
        replyId,
        model,
        systemPrompt,
        prompt: {text},
        vendorProgram: vendorProgramFor(provider),
        session,
      })
    },

    /** Its `RUN_FINISHED` comes from the host. */
    stop(treeId: string, replyId: string) {
      const provider = inFlight.writer(treeId, replyId)

      if (!provider) throw new Error('That Reply isn’t being written.')

      hosts.send(provider, {type: 'reply.stop', replyId})
    },

    hostEvent: (provider: ProviderId, event: ReplyEvent) =>
      inFlight.apply(provider, event),

    hostRecorded: (provider: ProviderId, recorded: ReplyRecorded) =>
      inFlight.record(provider, recorded),

    /** Fails the host's Replies with the text they last showed. */
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

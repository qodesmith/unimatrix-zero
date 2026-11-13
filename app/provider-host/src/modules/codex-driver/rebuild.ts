import type {AppServer} from './app-server'
import type {ResponseItem} from './protocol/ResponseItem'
import type {LoadedThread} from './threads'
import type {ParamsOf} from './wire'
import type {ReplyRequest, Thread} from '@uz/contract/host'

import {RequestRefused} from '#modules/failures/main'
import {explainingLabels, replyText} from '#modules/thread-replay/main'

import {configOf, loadThread} from './threads'

/** How Codex refuses to resume or fork a thread whose rollout it can't find. */
const SESSION_LOST = /no rollout found for thread id/

/**
 * `replay`: the thread holds nothing of the Thread, so the Prompt tells it.
 * `rebuilt`: the thread was started and given the Thread.
 */
interface Opened {
  thread: LoadedThread
  dropped: boolean
  replay: boolean
  rebuilt: boolean
}

export type Restored = Omit<Opened, 'replay' | 'rebuilt'>

export function settingsOf(request: ReplyRequest) {
  return {
    cwd: request.vendorProgram.configDir,
    sandbox: 'read-only',
    approvalPolicy: 'never',
    model: request.model,
    developerInstructions: request.systemPrompt || null,
  } satisfies ParamsOf<'thread/start'>
}

function prompted(text: string) {
  return {
    type: 'message',
    role: 'user',
    content: [{type: 'input_text', text}],
  } satisfies ResponseItem
}

function replied(text: string) {
  return {
    type: 'message',
    role: 'assistant',
    content: [{type: 'output_text', text}],
  } satisfies ResponseItem
}

function itemsOf(thread: Thread) {
  return thread.flatMap(exchange => {
    const reply = replyText(exchange)

    return [
      prompted(exchange.prompt),
      ...(reply === '' ? [] : [replied(reply)]),
    ]
  })
}

/**
 * Gives a new thread the Thread as its history, each Turn a message of its
 * own. False when Codex refuses the items, which leaves a text replay.
 */
async function injectThread(
  server: Pick<AppServer, 'request'>,
  threadId: string,
  thread: Thread
) {
  try {
    await server.request('thread/inject_items', {
      threadId,
      items: itemsOf(thread),
    })

    return true
  } catch (error) {
    if (!(error instanceof RequestRefused)) throw error

    return false
  }
}

/**
 * A new thread given the whole Thread: as history when Codex takes the items,
 * else in a thread of its own, with the Prompt.
 */
async function newThread(
  server: Pick<AppServer, 'request'>,
  threads: Map<string, LoadedThread>,
  request: ReplyRequest
): Promise<Opened> {
  const {threshold} = request.compactionSettings

  const settings = {
    ...settingsOf(request),
    developerInstructions:
      explainingLabels(request.systemPrompt, request.thread) || null,
  }

  async function open() {
    return loadThread(
      threads,
      await server.request(
        'thread/start',
        threshold === null
          ? settings
          : {...settings, config: configOf(threshold)}
      ),
      [],
      threshold
    )
  }

  const thread = await open()

  if (request.thread.length === 0) {
    return {thread, dropped: false, replay: false, rebuilt: false}
  }

  if (await injectThread(server, thread.id, request.thread)) {
    return {thread, dropped: false, replay: false, rebuilt: true}
  }

  threads.delete(thread.id)

  return {thread: await open(), dropped: false, replay: true, rebuilt: true}
}

/**
 * The one way a session is rebuilt from its Thread (ADR 0001): `restore`, the
 * exact restore from the app's copy, first, then a new thread for one Codex
 * no longer has. Null `restore`: the Provider has no session of the Thread.
 */
export async function openThread(
  server: Pick<AppServer, 'request'>,
  threads: Map<string, LoadedThread>,
  request: ReplyRequest,
  restore: (() => Promise<Restored>) | null
): Promise<Opened> {
  if (!restore) return newThread(server, threads, request)

  try {
    return {...(await restore()), replay: false, rebuilt: false}
  } catch (error) {
    const lost =
      error instanceof RequestRefused && SESSION_LOST.test(error.message)

    if (request.thread.length === 0 || !lost) throw error

    return newThread(server, threads, request)
  }
}

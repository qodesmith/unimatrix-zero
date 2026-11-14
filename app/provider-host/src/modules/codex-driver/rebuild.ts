import type {ContentPart, Piece} from '#modules/prompt-content/main'
import type {AppServer} from './app-server'
import type {ResponseItem} from './protocol/ResponseItem'
import type {LoadedThread} from './threads'
import type {ParamsOf} from './wire'
import type {ReplyRequest, Thread} from '@uz/contract/host'

import {RequestRefused} from '#modules/failures/main'
import {prompted} from '#modules/prompt-content/main'
import {explainingLabels, replyText} from '#modules/thread-replay/main'

import {messageContent} from './input'
import {configOf, loadThread} from './threads'

/** How Codex refuses to resume or fork a thread whose rollout it can't find. */
const SESSION_LOST = /no rollout found for thread id/

/**
 * `replay`: the thread holds nothing of the Thread, so the Prompt tells it.
 * `rebuilt`: the thread was started and given the Thread.
 */
export interface Opened {
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
    developerInstructions:
      explainingLabels(request.systemPrompt, request.thread) || null,
  } satisfies ParamsOf<'thread/start'>
}

/** Where threads open, and how a Prompt's files are read for Codex. */
export interface Opening {
  server: Pick<AppServer, 'request'>
  threads: Map<string, LoadedThread>
  read: (pieces: Piece[]) => Promise<ContentPart[]>
}

function replied(text: string) {
  return {
    type: 'message',
    role: 'assistant',
    content: [{type: 'output_text', text}],
  } satisfies ResponseItem
}

/** Each Prompt's files read afresh from the originals. */
async function itemsOf(thread: Thread, read: Opening['read']) {
  const turns = await Promise.all(
    thread.map(async exchange => {
      const reply = replyText(exchange)

      const prompt = {
        type: 'message',
        role: 'user',
        content: messageContent(
          await read(
            prompted({text: exchange.prompt, attachments: exchange.attachments})
          )
        ),
      } satisfies ResponseItem

      return [prompt, ...(reply === '' ? [] : [replied(reply)])]
    })
  )

  return turns.flat()
}

/**
 * Gives a new thread the Thread as its history, each Turn a message of its
 * own. False when Codex refuses the items, which leaves a text replay.
 */
async function injectThread(
  server: Opening['server'],
  threadId: string,
  items: Awaited<ReturnType<typeof itemsOf>>
) {
  try {
    await server.request('thread/inject_items', {threadId, items})

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
  {server, threads, read}: Opening,
  request: ReplyRequest
): Promise<Opened> {
  const {threshold} = request.compactionSettings

  const settings = settingsOf(request)
  // Before the thread starts, so an unreadable original leaves none behind.
  const items = await itemsOf(request.thread, read)

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

  if (await injectThread(server, thread.id, items)) {
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
  opening: Opening,
  request: ReplyRequest,
  restore: (() => Promise<Restored>) | null
): Promise<Opened> {
  if (!restore) return newThread(opening, request)

  try {
    return {...(await restore()), replay: false, rebuilt: false}
  } catch (error) {
    const lost =
      error instanceof RequestRefused && SESSION_LOST.test(error.message)

    if (request.thread.length === 0 || !lost) throw error

    return newThread(opening, request)
  }
}

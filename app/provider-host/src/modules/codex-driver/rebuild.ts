import type {AppServer} from './app-server'
import type {ResponseItem} from './protocol/ResponseItem'
import type {Thread} from '@uz/contract/host'

import {RequestRefused} from '#modules/failures/main'
import {replyText} from '#modules/thread-replay/main'

/** How Codex refuses to resume or fork a thread whose rollout it can't find. */
const SESSION_LOST = /no rollout found for thread id/

export function sessionLost(error: unknown) {
  return error instanceof RequestRefused && SESSION_LOST.test(error.message)
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
export async function injectThread(
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

import type {ReplyRequest, ReplySession} from '@uz/contract/host'

import {prompted, readContent} from '#modules/prompt-content/main'
import {replayed} from '#modules/thread-replay/main'

export type Restore = 'none' | 'store' | 'file'

/** The last message kept, when a fork, a rewind or a Retry's cut cuts it. */
export function cutAt(session: ReplySession) {
  switch (session.type) {
    case 'continue':
      return null
    case 'fork':
    case 'rewind':
      return session.messageId
    case 'cut':
      return session.keepThrough
    default:
      throw new Error('Unknown session.')
  }
}

export function servedThrough(session: ReplyRequest['session']) {
  return session?.type === 'fork' ? session.servedThrough : undefined
}

export function resumption(session: ReplyRequest['session'], restore: Restore) {
  if (!session || restore === 'none') {
    return {resume: null, fork: false, upTo: null}
  }

  return {
    resume: session.sessionId,
    fork: session.type === 'fork',
    upTo: cutAt(session),
  }
}

/**
 * A session started for a Thread is told all of it with its first Prompt,
 * each inline file read afresh.
 */
export async function contentOf({session, thread, prompt}: ReplyRequest) {
  return readContent(
    session === null && thread.length > 0
      ? replayed(thread, prompt)
      : prompted(prompt)
  )
}

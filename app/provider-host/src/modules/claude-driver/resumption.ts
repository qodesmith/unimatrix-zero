import type {ConvertPdf} from '#modules/prompt-content/main'
import type {Silent} from './heard'
import type {SDKResultMessage} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest, ReplySession} from '@uz/contract/host'
import type {RunFailure} from '@uz/contract/turns'

import {prompted, readContent} from '#modules/prompt-content/main'
import {replayed} from '#modules/thread-replay/main'
import {PROVIDER_CAPABILITIES} from '@uz/contract/providers'

export type Restore = 'none' | 'store' | 'file'

/** `heard` says whether `claude` sent anything back to the Prompt. */
export type Outcome =
  | {result: SDKResultMessage}
  | {failure: RunFailure; heard: boolean}
  | Silent

/**
 * How `claude` refuses a session it has no transcript of, and a point to
 * resume at that is off the session's newest chain. It writes nothing to the
 * session either time.
 */
const SESSION_LOST =
  /No conversation found with session ID|No message found with message\.uuid of/

export function sessionLost(outcome: Outcome) {
  if ('failure' in outcome) return SESSION_LOST.test(outcome.failure.message)

  if ('silent' in outcome) return false

  const {result} = outcome

  return (
    result.subtype !== 'success' && SESSION_LOST.test(result.errors.join(' '))
  )
}

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
 * each file read from its original.
 */
export async function contentOf(request: ReplyRequest, convertPdf: ConvertPdf) {
  const {session, thread, prompt} = request

  return readContent(
    session === null && thread.length > 0
      ? replayed(thread, prompt)
      : prompted(prompt),
    {
      pdfAttachments: PROVIDER_CAPABILITIES.claude.pdfAttachments,
      conversionDir: request.conversionDir,
      convertPdf,
    }
  )
}

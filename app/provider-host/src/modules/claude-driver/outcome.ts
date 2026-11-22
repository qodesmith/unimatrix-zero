import type {Silent} from './heard'
import type {SDKResultMessage} from '@anthropic-ai/claude-agent-sdk'
import type {RunFailure} from '@uz/contract/turns'

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

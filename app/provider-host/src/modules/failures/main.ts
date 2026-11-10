import type {TerminalReason} from '@anthropic-ai/claude-agent-sdk'
import type {RunFailure} from '@uz/contract/turns'

import {z} from 'zod'

const CONNECTION_LOST =
  /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|fetch failed|network|connection (?:error|lost|reset|closed|refused)|socket hang up|offline|stream (?:disconnected|closed|ended)/i

const LIMIT_REACHED =
  /rate.?limit|usage limit|limit reached|hit your limit|quota|too many requests|\b429\b|out of (?:usage|credits)|insufficient[_ ]quota/i

const DISK_FULL = /ENOSPC|no space left|disk (?:is )?full/i

/**
 * A Model the pinned vendor program is too old for (ADR 0008), in OpenAI's
 * wording, assumed the same for Claude Code.
 */
const NEEDS_APP_UPDATE = /requires a newer version of (?:Codex|Claude Code)\b/i

/** "resets at 3:00 PM", "resets 2026-10-24T15:00:00Z", "reset in 2 hours". */
const RESETS = /resets?\s+(?:at|on|in)?\s*:?\s*([^.;,()]+)/i

const UNIX_SECONDS = /^\d{10}$/

/**
 * The `data` of an error Codex refused a request with. It counts Unicode code
 * points, summed over the request's text.
 */
export const RefusalSchema = z.looseObject({
  input_error_code: z.string().optional(),
  max_chars: z.number().int().nonnegative().optional().catch(undefined),
  actual_chars: z.number().int().nonnegative().optional().catch(undefined),
})

type Refusal = z.infer<typeof RefusalSchema>

export class RequestRefused extends Error {
  readonly data: Refusal | undefined

  constructor(message: string, data: Refusal | undefined) {
    super(message)
    this.data = data
  }
}

/** What a Provider reported beside the message; these name the failure first. */
export interface FailureSignals {
  /** In seconds since the epoch; it wins over the message's time. */
  resetsAt?: number | undefined
  /** Claude rejected the turn for a usage limit, with or without a reset time. */
  limitRejected?: boolean | undefined
  refusal?: Refusal | undefined
  codexErrorInfo?: unknown
  /** Claude's `terminal_reason`. */
  terminalReason?: TerminalReason | undefined
}

function resetsAtIn(message: string): string | undefined {
  const when = RESETS.exec(message)?.[1]?.trim()

  if (!when) return undefined

  const at = UNIX_SECONDS.test(when) ? Number(when) * 1000 : Date.parse(when)

  return Number.isNaN(at) ? undefined : new Date(at).toISOString()
}

function refusedAsTooLong(
  message: string,
  {refusal, codexErrorInfo, terminalReason}: FailureSignals
): RunFailure | null {
  const overCap = refusal?.input_error_code === 'input_too_large'

  if (
    overCap &&
    refusal.actual_chars !== undefined &&
    refusal.max_chars !== undefined
  ) {
    return {
      code: 'too-long',
      message,
      promptChars: refusal.actual_chars,
      maxPromptChars: refusal.max_chars,
    }
  }

  return overCap ||
    codexErrorInfo === 'contextWindowExceeded' ||
    terminalReason === 'prompt_too_long'
    ? {code: 'too-long', message}
    : null
}

function limitReached(message: string, resetsAt?: number): RunFailure {
  const lifts =
    resetsAt === undefined
      ? resetsAtIn(message)
      : new Date(resetsAt * 1000).toISOString()

  return lifts === undefined
    ? {code: 'limit-reached', message}
    : {code: 'limit-reached', message, resetsAt: lifts}
}

export function failureOf(
  message: string,
  signals: FailureSignals = {}
): RunFailure {
  const tooLong = refusedAsTooLong(message, signals)

  if (tooLong) return tooLong

  const {resetsAt, limitRejected, terminalReason} = signals

  // A limit or a lost connection that failed the Compaction leaves the turn
  // blocked as well, and it is what the user can wait out or Retry.
  if (terminalReason === 'blocking_limit') {
    if (
      limitRejected ||
      resetsAt !== undefined ||
      LIMIT_REACHED.test(message)
    ) {
      return limitReached(message, resetsAt)
    }

    return CONNECTION_LOST.test(message)
      ? {code: 'connection-lost', message}
      : {code: 'too-long', message}
  }

  if (NEEDS_APP_UPDATE.test(message)) return {code: 'needs-app-update', message}

  if (CONNECTION_LOST.test(message)) return {code: 'connection-lost', message}

  if (LIMIT_REACHED.test(message)) return limitReached(message, resetsAt)

  if (DISK_FULL.test(message)) return {code: 'disk-full', message}

  return {code: 'provider-error', message}
}

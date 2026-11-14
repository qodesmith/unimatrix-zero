import type {
  SDKAssistantMessageError,
  TerminalReason,
} from '@anthropic-ai/claude-agent-sdk'
import type {RunFailure} from '@uz/contract/turns'

import {z} from 'zod'

/** The operating system's text for a full disk, whatever wrote the file. */
const DISK_FULL = /ENOSPC|no space left|disk (?:is )?full/i

/**
 * A Model the pinned vendor program is too old for (ADR 0008), in OpenAI's
 * wording, assumed the same for Claude Code. No typed code marks it.
 */
const NEEDS_APP_UPDATE = /requires a newer version of (?:Codex|Claude Code)\b/i

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

/** A throttle or an overload: the server answered, so the connection is fine. */
export function isBusyStatus(status: number | null) {
  return status === 429 || status === 529
}

/** What `claude` reported over a Reply that failed, beside its message. */
export interface ClaudeSignals {
  terminalReason?: TerminalReason | undefined
  /** The result's; null when no response came. */
  apiErrorStatus?: number | null | undefined
  /** The last `api_retry`'s `error_status`; undefined when none came. */
  retryStatus?: number | null | undefined
  /** The last assistant message's `error`. */
  assistantError?: SDKAssistantMessageError | undefined
  /**
   * Set when the last `rate_limit_event` was rejected; in seconds since the
   * epoch.
   */
  rejectedLimit?: {resetsAt?: number | undefined} | undefined
  /** The last Compaction `status` message said it failed. */
  compactionFailed?: boolean | undefined
}

/** What Codex reported over a turn that failed, beside its message. */
export interface CodexSignals {
  /** The turn error's. */
  codexErrorInfo?: unknown
  /** The `codexErrorInfo` of the last `error` notification with `willRetry`. */
  retryErrorInfo?: unknown
  /** From the rate-limit snapshot, in seconds since the epoch. */
  resetsAt?: number | undefined
}

const NoStatusSchema = z.looseObject({httpStatusCode: z.null()})

const StreamLostSchema = z.looseObject({
  responseStreamDisconnected: NoStatusSchema,
})

const ConnectFailedSchema = z.looseObject({
  httpConnectionFailed: NoStatusSchema,
})

const ThrottledSchema = z.looseObject({
  responseTooManyFailedAttempts: z.looseObject({
    httpStatusCode: z.literal(429),
  }),
})

const CODEX_LIMITS: unknown[] = ['usageLimitExceeded', 'rateLimitExceeded']

function limitReached(message: string, resetsAt?: number): RunFailure {
  return resetsAt === undefined
    ? {code: 'limit-reached', message}
    : {
        code: 'limit-reached',
        message,
        resetsAt: new Date(resetsAt * 1000).toISOString(),
      }
}

/** The kinds no typed field marks, else a provider error. */
function byWording(message: string): RunFailure {
  if (NEEDS_APP_UPDATE.test(message)) return {code: 'needs-app-update', message}

  if (DISK_FULL.test(message)) return {code: 'disk-full', message}

  return {code: 'provider-error', message}
}

/** A failure that came with no typed fields, such as a throw. */
export function failureOf(message: string, refusal?: Refusal): RunFailure {
  if (refusal?.input_error_code !== 'input_too_large') return byWording(message)

  return refusal.actual_chars !== undefined && refusal.max_chars !== undefined
    ? {
        code: 'too-long',
        message,
        promptChars: refusal.actual_chars,
        maxPromptChars: refusal.max_chars,
      }
    : {code: 'too-long', message}
}

export function claudeFailureOf(
  message: string,
  signals: ClaudeSignals
): RunFailure {
  const {terminalReason, rejectedLimit} = signals

  if (terminalReason === 'prompt_too_long') return {code: 'too-long', message}

  if (rejectedLimit) return limitReached(message, rejectedLimit.resetsAt)

  if (signals.assistantError === 'billing_error') return limitReached(message)

  // A failed Compaction is worth a Retry whatever failed it: a refused
  // connection and a 500 send the same fields.
  if (terminalReason === 'blocking_limit') {
    return signals.compactionFailed
      ? {code: 'connection-lost', message}
      : {code: 'too-long', message}
  }

  if (
    terminalReason === 'api_error' &&
    signals.apiErrorStatus === null &&
    signals.retryStatus === null
  ) {
    return {code: 'connection-lost', message}
  }

  return byWording(message)
}

export function codexFailureOf(
  message: string,
  {codexErrorInfo, retryErrorInfo, resetsAt}: CodexSignals
): RunFailure {
  if (codexErrorInfo === 'contextWindowExceeded') {
    return {code: 'too-long', message}
  }

  if (
    CODEX_LIMITS.includes(codexErrorInfo) ||
    ThrottledSchema.safeParse(codexErrorInfo).success
  ) {
    return limitReached(message, resetsAt)
  }

  if (
    StreamLostSchema.safeParse(retryErrorInfo).success &&
    (codexErrorInfo === 'other' ||
      ConnectFailedSchema.safeParse(codexErrorInfo).success)
  ) {
    return {code: 'connection-lost', message}
  }

  return byWording(message)
}

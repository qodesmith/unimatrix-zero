import type {RunFailure} from '@uz/contract/turns'

const CONNECTION_LOST =
  /ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|EPIPE|fetch failed|network|connection (?:error|lost|reset|closed|refused)|socket hang up|offline|stream (?:disconnected|closed|ended)/i

const LIMIT_REACHED =
  /rate.?limit|usage limit|limit reached|hit your limit|quota|too many requests|\b429\b|out of (?:usage|credits)|insufficient[_ ]quota/i

const DISK_FULL = /ENOSPC|no space left|disk (?:is )?full/i

/** "resets at 3:00 PM", "resets 2026-10-24T15:00:00Z", "reset in 2 hours". */
const RESETS = /resets?\s+(?:at|on|in)?\s*:?\s*([^.;,()]+)/i

const UNIX_SECONDS = /^\d{10}$/

function resetsAtIn(message: string): string | undefined {
  const when = RESETS.exec(message)?.[1]?.trim()

  if (!when) return undefined

  const at = UNIX_SECONDS.test(when) ? Number(when) * 1000 : Date.parse(when)

  return Number.isNaN(at) ? undefined : new Date(at).toISOString()
}

/** `resetsAt` is in seconds since the epoch; it wins over the message's time. */
export function failureOf(message: string, resetsAt?: number): RunFailure {
  if (CONNECTION_LOST.test(message)) return {code: 'connection-lost', message}

  if (LIMIT_REACHED.test(message)) {
    const lifts =
      resetsAt === undefined
        ? resetsAtIn(message)
        : new Date(resetsAt * 1000).toISOString()

    return lifts === undefined
      ? {code: 'limit-reached', message}
      : {code: 'limit-reached', message, resetsAt: lifts}
  }

  if (DISK_FULL.test(message)) return {code: 'disk-full', message}

  return {code: 'provider-error', message}
}

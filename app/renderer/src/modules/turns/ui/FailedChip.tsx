import type {ProviderId, ProviderStatus} from '@uz/contract/providers'
import type {Reply, RunFailure} from '@uz/contract/turns'

import {useProviderStatus} from '#modules/connections/main'
import {Button} from '#shadcn/ui/button'
import {PROVIDER_NAMES} from '@uz/contract/providers'

import {useReplyRun} from '../reply-run/use-reply-run'
import {useReply} from '../use-live-reply'
import {useOnline} from '../use-online'

const NOT_READY: Record<
  Exclude<ProviderStatus['status'], 'ready'>,
  (name: string) => string
> = {
  'signed-out': name => `Sign in to ${name} again to retry`,
  'not-connected': name => `Connect ${name} to retry`,
  starting: name => `${name} is starting…`,
  restarting: name => `${name} is starting…`,
  failed: name => `${name} isn't running`,
}

/** Null when Retry may run; '' until main reports the Provider's status. */
function retryHeldBecause(
  online: boolean,
  status: ProviderStatus['status'] | null,
  provider: ProviderId
) {
  if (!online) return 'Offline · Retry waits for the connection'

  if (status === null) return ''

  if (status === 'ready') return null

  return NOT_READY[status](PROVIDER_NAMES[provider])
}

function RetryControls({reply}: {reply: Reply}) {
  const {state, retry} = useReplyRun(reply.treeId, reply.id)
  const online = useOnline()
  const providerStatus = useProviderStatus(reply.provider)
  const held = retryHeldBecause(online, providerStatus, reply.provider)

  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={held !== null || state.status === 'retrying'}
        onClick={retry}
      >
        Retry
      </Button>
      {held ? (
        <span className="text-xs text-muted-foreground">{held}</span>
      ) : (
        state.status === 'retryRefused' && (
          <span className="text-xs text-destructive">{state.error}</span>
        )
      )}
    </div>
  )
}

const resetTime = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

const count = new Intl.NumberFormat()

const FAILURE_LINES: Record<
  RunFailure['code'],
  (failure: RunFailure, name: string) => string
> = {
  'connection-lost': () => 'Connection lost',
  'limit-reached': ({resetsAt}) =>
    resetsAt === undefined
      ? 'Limit reached'
      : `Limit reached · resets at ${resetTime.format(new Date(resetsAt))}`,
  'program-crashed': (_, name) => `${name} stopped unexpectedly`,
  'host-crashed': (_, name) => `${name} stopped unexpectedly`,
  'disk-full': () => 'Disk full',
  'host-unreachable': (_, name) => `${name} could not be reached`,
  'driver-error': ({message}) => message,
  'provider-error': ({message}) => message,
  'too-long': ({promptChars, maxPromptChars}) =>
    promptChars === undefined || maxPromptChars === undefined
      ? 'Too long for the Context window'
      : `Prompt too long · ${count.format(promptChars)} characters, limit ${count.format(maxPromptChars)}`,
  'needs-app-update': () => 'Needs an app update',
  'fake-failure': ({message}) => message,
}

function describeFailure(failure: RunFailure, provider: ProviderId) {
  return FAILURE_LINES[failure.code](failure, PROVIDER_NAMES[provider])
}

/**
 * A failed Reply in the Thread: the exchange the AI never saw, so neither its
 * Prompt nor any text it wrote shows. The caller owns its place.
 */
export function FailedChip({reply}: {reply: Reply}) {
  const {failure} = useReply(reply)

  return (
    <div
      role="group"
      aria-label="Failed Reply"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-destructive bg-card px-3.5 py-2 text-xs shadow-sm"
    >
      <span className="font-medium text-destructive">Failed</span>
      {failure && (
        <span className="text-destructive">
          {describeFailure(failure, reply.provider)}
        </span>
      )}
      {failure?.code !== 'too-long' && <RetryControls reply={reply} />}
    </div>
  )
}

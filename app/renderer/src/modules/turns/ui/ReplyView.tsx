import type {ThinkingBlock} from '../live-replies'
import type {ProviderId, ProviderStatus} from '@uz/contract/providers'
import type {
  Reply,
  ReplyPart,
  ReplyStatus,
  RunFailure,
} from '@uz/contract/turns'

import {useProviderStatus} from '#modules/connections/main'
import {ReplyMarkdown} from '#modules/markdown/main'
import {Button} from '#modules/shadcn/main'
import {PROVIDER_NAMES} from '@uz/contract/providers'
import {Fragment, useState} from 'react'

import {useLiveReply, useThinking} from '../use-live-reply'
import {useOnline} from '../use-online'
import {stopReply, useRetryReply} from '../use-turns'

type ToolCall = Extract<ReplyPart, {type: 'tool-call'}>

/** A Reply's content, live while it streams; the caller owns its box. */
export function ReplyView({reply}: {reply: Reply}) {
  const live = useLiveReply(reply.id)
  const blocks = useThinking(reply.id)
  const {status, content, failure} = live ?? reply
  const streaming = status === 'streaming'

  function thinkingBefore(part: number) {
    return blocks.flatMap((block, index) =>
      block.beforePart === part
        ? [
            // oxlint-disable-next-line react/no-array-index-key -- blocks only ever append, so positions are stable
            <ThinkingBlockView key={index} block={block} />,
          ]
        : []
    )
  }

  return (
    <article
      aria-label="Reply"
      aria-busy={streaming}
      className="flex flex-col gap-2 text-sm"
    >
      {content.map((part, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- parts only ever append, so positions are stable
        <Fragment key={index}>
          {thinkingBefore(index)}
          {part.type === 'text' ? (
            <ReplyMarkdown
              text={part.text}
              streaming={streaming && index === content.length - 1}
            />
          ) : (
            <ToolCallView part={part} />
          )}
        </Fragment>
      ))}
      {thinkingBefore(content.length)}
      {streaming && (
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Writing…</span>
          <StopButton treeId={reply.treeId} replyId={reply.id} />
        </div>
      )}
      <StatusLine status={status} failure={failure} provider={reply.provider} />
      {status === 'failed' && <RetryControls reply={reply} />}
    </article>
  )
}

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

/**
 * Why Retry is held, or null when it may run; '' until main reports the
 * Provider's status.
 */
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

/** Mounted only while the Reply has failed, so a retry that takes resets it. */
function RetryControls({reply}: {reply: Reply}) {
  const retryReply = useRetryReply(reply.treeId)
  const online = useOnline()
  const providerStatus = useProviderStatus(reply.provider)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const held = retryHeldBecause(online, providerStatus, reply.provider)

  async function retry() {
    setRetrying(true)
    setError(null)
    const outcome = await retryReply(reply.id)

    setRetrying(false)

    if (!outcome.ok) setError(outcome.error)
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={held !== null || retrying}
        onClick={() => void retry()}
      >
        Retry
      </Button>
      {held ? (
        <span className="text-xs text-muted-foreground">{held}</span>
      ) : (
        error && <span className="text-xs text-destructive">{error}</span>
      )}
    </div>
  )
}

/** Mounted only while the Reply streams, so a retry starts it fresh. */
function StopButton({treeId, replyId}: {treeId: string; replyId: string}) {
  const [stopping, setStopping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function stop() {
    setStopping(true)
    setError(null)
    const refused = await stopReply(treeId, replyId)

    if (refused !== null) {
      setError(refused)
      setStopping(false)
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-6 px-2 text-xs"
        disabled={stopping}
        onClick={() => void stop()}
      >
        {stopping ? 'Stopping…' : 'Stop'}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </>
  )
}

const resetTime = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit',
})

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
  'fake-failure': ({message}) => message,
}

function describeFailure(failure: RunFailure, provider: ProviderId) {
  return FAILURE_LINES[failure.code](failure, PROVIDER_NAMES[provider])
}

function StatusLine({
  status,
  failure,
  provider,
}: {
  status: ReplyStatus
  failure: RunFailure | null
  provider: ProviderId
}) {
  if (status === 'failed') {
    return (
      <span className="text-xs text-destructive">
        {failure ? describeFailure(failure, provider) : 'Failed'}
      </span>
    )
  }

  if (status === 'stopped' || status === 'interrupted') {
    return (
      <span className="text-xs text-muted-foreground">
        {status === 'stopped' ? 'Stopped' : 'Interrupted when the app quit'}
      </span>
    )
  }

  return null
}

function describeDuration(ms: number) {
  if (ms < 1000) return 'under a second'

  if (ms < 60_000) return `${Math.round(ms / 1000)}s`

  return `${Math.round(ms / 60_000)}m`
}

function ThinkingBlockView({block}: {block: ThinkingBlock}) {
  const {text, startedAt, endedAt} = block

  return (
    <details className="rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        {endedAt === null
          ? 'Thinking…'
          : `Thought for ${describeDuration(endedAt - startedAt)}`}
      </summary>
      <p className="mt-1 whitespace-pre-wrap">{text}</p>
    </details>
  )
}

function prettyArgs(args: string) {
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args
  }
}

function ToolCallView({part}: {part: ToolCall}) {
  const {toolName, args, result} = part

  return (
    <details
      aria-label={`Tool call ${toolName}`}
      className="self-start rounded-md border border-border bg-muted/50 px-2 py-1 text-xs"
    >
      <summary className="cursor-pointer select-none">
        <span className="font-medium">{toolName}</span>
        <span className="ml-2 text-muted-foreground">
          {result === null ? 'running…' : result.isError ? 'failed' : 'done'}
        </span>
      </summary>
      <dl className="mt-1 flex flex-col gap-1">
        <dt className="text-muted-foreground">Arguments</dt>
        <dd>
          <pre className="overflow-x-auto whitespace-pre-wrap">
            {prettyArgs(args)}
          </pre>
        </dd>
        {result && (
          <>
            <dt className="text-muted-foreground">Result</dt>
            <dd>
              <pre
                className={`overflow-x-auto whitespace-pre-wrap ${result.isError ? 'text-destructive' : ''}`}
              >
                {result.content}
              </pre>
            </dd>
          </>
        )}
      </dl>
    </details>
  )
}

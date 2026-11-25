import type {ApprovalItem} from '../live-approvals'
import type {ThinkingBlock, Wait} from '../live-replies'
import type {Reply, ReplyPart, ReplyStatus} from '@uz/contract/turns'

import {ProviderMark} from '#modules/connections/main'
import {ReplyMarkdown} from '#modules/markdown/main'
import {useModelName} from '#modules/models/main'
import {Badge} from '#shadcn/ui/badge'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '#shadcn/ui/collapsible'
import {Marker, MarkerContent} from '#shadcn/ui/marker'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from '#shadcn/ui/trace'
import {cn} from 'cn'
import {ChevronRightIcon} from 'lucide-react'
import {Fragment} from 'react'

import {
  useApprovals,
  useReply,
  useThinking,
  useWaiting,
} from '../use-live-reply'
import {useOnline} from '../use-online'
import {ApprovalView} from './ApprovalView'
import {ChangedFiles} from './ChangedFiles'

type ToolCall = Extract<ReplyPart, {type: 'tool-call'}>

type Aside =
  | {kind: 'thinking'; at: number; key: string; block: ThinkingBlock}
  | {kind: 'approval'; at: number; key: string; item: ApprovalItem}

/** What sits before part `part` of the content, in the order it arrived. */
function asidesBefore(
  part: number,
  blocks: ThinkingBlock[],
  approvals: ApprovalItem[]
): Aside[] {
  return [
    ...blocks.flatMap((block, index): Aside[] =>
      block.beforePart === part
        ? [
            {
              kind: 'thinking',
              at: block.startedAt,
              key: `thinking-${index}`,
              block,
            },
          ]
        : []
    ),
    ...approvals.flatMap((item): Aside[] =>
      item.afterParts === part
        ? [
            {
              kind: 'approval',
              at: item.arrivedAt,
              key: `${item.kind}-${item.id}`,
              item,
            },
          ]
        : []
    ),
  ].toSorted((a, b) => a.at - b.at)
}

export function ReplyView({reply}: {reply: Reply}) {
  const blocks = useThinking(reply.id)
  const approvals = useApprovals(reply.id)
  const {status, content, compacted, rebuilt} = useReply(reply)
  const streaming = status === 'streaming'

  function asidesAt(part: number) {
    return asidesBefore(part, blocks, approvals).map(aside =>
      aside.kind === 'thinking' ? (
        <ThinkingBlockView key={aside.key} block={aside.block} />
      ) : (
        <ApprovalView
          key={aside.key}
          treeId={reply.treeId}
          replyId={reply.id}
          item={aside.item}
        />
      )
    )
  }

  return (
    <article
      aria-label="Reply"
      aria-busy={streaming}
      className="flex flex-col gap-2 text-sm"
    >
      {compacted && <CompactionMarker />}
      <WrittenBy reply={reply} />
      {rebuilt && (
        <span className="text-xs text-muted-foreground">
          Re-read the whole conversation to go on
        </span>
      )}
      {content.map((part, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- parts only ever append, so positions are stable
        <Fragment key={index}>
          {asidesAt(index)}
          {part.type === 'text' ? (
            <ReplyMarkdown
              text={part.text}
              streaming={streaming && index === content.length - 1}
            />
          ) : (
            <ToolCallView part={part} streaming={streaming} />
          )}
        </Fragment>
      ))}
      {asidesAt(content.length)}
      {!streaming && <ChangedFiles files={reply.files} />}
      {streaming && <StreamingLine replyId={reply.id} />}
      <StatusLine status={status} />
    </article>
  )
}

function CompactionMarker() {
  return (
    <Marker
      variant="separator"
      className="text-xs before:min-w-6 after:min-w-6"
    >
      <MarkerContent className="text-balance group-data-[variant=separator]/marker:flex-initial">
        Compacted here. The AI remembers earlier Turns from a summary.
      </MarkerContent>
    </Marker>
  )
}

function WrittenBy({reply}: {reply: Reply}) {
  const name = useModelName(reply.provider, reply.model)

  return (
    <div className="flex items-center gap-1.5 text-muted-foreground">
      <ProviderMark provider={reply.provider} />
      <Badge variant="outline" className="font-normal text-muted-foreground">
        {name}
      </Badge>
    </div>
  )
}

const WAIT_LABELS: Record<Wait, string> = {
  busy: 'Busy, retrying…',
  reconnecting: 'Reconnecting…',
}

function streamingLabel(online: boolean, wait: Wait | undefined) {
  if (!online) return 'Offline · waiting for the connection'

  return wait ? WAIT_LABELS[wait] : 'Writing…'
}

function StreamingLine({replyId}: {replyId: string}) {
  const label = streamingLabel(useOnline(), useWaiting(replyId))

  return <span className="text-xs text-muted-foreground">{label}</span>
}

function StatusLine({status}: {status: ReplyStatus}) {
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
    <Collapsible className="rounded-md bg-muted/50 px-2 py-1 text-xs text-muted-foreground">
      <CollapsibleTrigger className="group/thinking-trigger flex w-full cursor-pointer items-center gap-1 text-left select-none">
        <ChevronRightIcon className="size-3 shrink-0 transition-transform group-aria-expanded/thinking-trigger:rotate-90" />
        {endedAt === null
          ? 'Thinking…'
          : `Thought for ${describeDuration(endedAt - startedAt)}`}
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted>
        <p className="mt-1 whitespace-pre-wrap">{text}</p>
      </CollapsibleContent>
    </Collapsible>
  )
}

function prettyArgs(args: string) {
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args
  }
}

const TOOL_PROGRESS = {
  running: {label: 'running…', status: 'running'},
  cutOff: {label: 'cut off', status: undefined},
  failed: {label: 'failed', status: 'error'},
  done: {label: 'done', status: undefined},
} as const

function toolProgress(result: ToolCall['result'], streaming: boolean) {
  if (result === null) return streaming ? 'running' : 'cutOff'

  return result.isError ? 'failed' : 'done'
}

function ToolCallView({part, streaming}: {part: ToolCall; streaming: boolean}) {
  const {toolName, args, result} = part
  const progress = toolProgress(result, streaming)

  return (
    <Trace
      role="group"
      aria-label={`Tool call ${toolName}`}
      className="w-auto max-w-full self-start text-xs"
    >
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine
            status={TOOL_PROGRESS[progress].status}
            className="text-xs"
          >
            <TraceTitle className="font-medium">{toolName}</TraceTitle>
            <TraceDescription>{TOOL_PROGRESS[progress].label}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <dl className="flex flex-col gap-1">
            <dt>Arguments</dt>
            <dd className="text-foreground">
              <pre className="overflow-x-auto whitespace-pre-wrap">
                {prettyArgs(args)}
              </pre>
            </dd>
            {result && (
              <>
                <dt>Result</dt>
                <dd className="text-foreground">
                  <pre
                    className={cn(
                      'overflow-x-auto whitespace-pre-wrap',
                      result.isError && 'text-destructive'
                    )}
                  >
                    {result.content}
                  </pre>
                </dd>
              </>
            )}
          </dl>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  )
}

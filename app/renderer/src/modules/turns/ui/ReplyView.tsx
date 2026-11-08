import type {ThinkingBlock} from '../live-replies'
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

import {useReply, useThinking} from '../use-live-reply'

type ToolCall = Extract<ReplyPart, {type: 'tool-call'}>

/** A Reply's content, live while it streams; the caller owns its box. */
export function ReplyView({reply}: {reply: Reply}) {
  const blocks = useThinking(reply.id)
  const {status, content} = useReply(reply)
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
      <WrittenBy reply={reply} />
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
        <span className="text-xs text-muted-foreground">Writing…</span>
      )}
      <StatusLine status={status} />
    </article>
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
  failed: {label: 'failed', status: 'error'},
  done: {label: 'done', status: undefined},
} as const

function ToolCallView({part}: {part: ToolCall}) {
  const {toolName, args, result} = part

  const progress =
    result === null ? 'running' : result.isError ? 'failed' : 'done'

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

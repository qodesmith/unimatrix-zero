import type {ThinkingSummary} from '../live-replies'
import type {Reply, ReplyPart} from '@uz/contract/turns'

import {ReplyMarkdown} from '#modules/markdown/main'
import {Fragment} from 'react'

import {useLiveReply, useThinking} from '../use-live-reply'

type ToolCall = Extract<ReplyPart, {type: 'tool-call'}>

/** Re-renders only when this Reply changes, from the stream or once saved. */
export function ReplyView({reply}: {reply: Reply}) {
  const live = useLiveReply(reply.id)
  const summaries = useThinking(reply.id)
  const {status, content} = live ?? reply
  const streaming = status === 'streaming'

  function thinkingBefore(part: number) {
    return summaries.flatMap((summary, round) =>
      summary.beforePart === part
        ? [
            // oxlint-disable-next-line react/no-array-index-key -- rounds only ever append, so positions are stable
            <ThinkingSummaryView key={round} summary={summary} />,
          ]
        : []
    )
  }

  return (
    <article
      aria-label="Reply"
      aria-busy={streaming}
      className="flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-card-foreground"
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
        <span className="text-xs text-muted-foreground">Writing…</span>
      )}
      {status === 'failed' && (
        <span className="text-xs text-destructive">This Reply failed.</span>
      )}
    </article>
  )
}

function describeDuration(ms: number) {
  if (ms < 1000) return 'under a second'

  if (ms < 60_000) return `${Math.round(ms / 1000)}s`

  return `${Math.round(ms / 60_000)}m`
}

/** One stretch of thinking, collapsed, with how long it took once it moved on. */
function ThinkingSummaryView({summary}: {summary: ThinkingSummary}) {
  const {text, startedAt, endedAt} = summary

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

/** The arguments as JSON when they parse, otherwise as the Provider sent them. */
function prettyArgs(args: string) {
  try {
    return JSON.stringify(JSON.parse(args), null, 2)
  } catch {
    return args
  }
}

/** A tool call where it happened: its name, arguments and result. */
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

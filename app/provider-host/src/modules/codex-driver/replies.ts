import type {ContentEvent} from '#modules/reply-runs/main'
import type {Item, Notification, ToolItem} from './wire'
import type {ReplyRequest} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {codexFailureOf, isBusyStatus} from '#modules/failures/main'

import {
  AgentMessageItemSchema,
  CONTEXT_COMPACTION,
  ToolItemSchema,
} from './wire'

type ReplyIds = Pick<ReplyRequest, 'treeId' | 'replyId'>

type RunFinished = Extract<ReplyEvent, {type: 'RUN_FINISHED'}>

type CodexTurn = Extract<
  Notification,
  {method: 'turn/completed'}
>['params']['turn']

/** A malformed tool item reads as some other item, as an unknown one does. */
function toolItemOf(item: Item): ToolItem | null {
  const tool = ToolItemSchema.safeParse(item)

  return tool.success ? tool.data : null
}

function argsOf(item: ToolItem) {
  if (item.type === 'commandExecution') {
    return {command: item.command, cwd: item.cwd}
  }

  return {changes: item.changes}
}

function resultOf(item: ToolItem) {
  if (item.type === 'commandExecution') {
    return {
      content: item.aggregatedOutput ?? '',
      isError:
        item.status !== 'completed' ||
        (item.exitCode !== null && item.exitCode !== 0),
    }
  }

  return {
    content: item.changes
      .map(change => `${change.kind.type} ${change.path}`)
      .join('\n'),
    isError: item.status !== 'completed',
  }
}

type AccountNotification = Extract<Notification, {method: `account/${string}`}>

function aboutTheAccount(
  notification: Notification
): notification is AccountNotification {
  return notification.method.startsWith('account/')
}

export function turnOf(notification: Notification) {
  if (notification.method === 'turn/completed') {
    return notification.params.turn.id
  }

  if (aboutTheAccount(notification)) return null

  return notification.params.turnId
}

/**
 * When a finished message differs from what streamed, its text replaces it.
 * Reasoning is passed on for display and never kept. The text tracked is the
 * current text part's, which a tool call ends.
 */
export function createReplyMapper(ids: ReplyIds) {
  let shown = ''
  const toolCalls = new Set<string>()

  const messages = new Map<
    string,
    {before: string; text: string; done: boolean}
  >()

  let last: string | null = null
  let retryErrorInfo: unknown

  /**
   * After a lost connection, `codex` starts the message over as a new one and
   * never finishes the old, at times without notifying that it retried.
   */
  function dropUnfinished() {
    const message = last === null ? undefined : messages.get(last)

    if (!message || message.done) return false

    shown = message.before

    return true
  }

  function addMessage(
    itemId: string,
    text: string,
    done: boolean
  ): ContentEvent[] {
    const dropped = dropUnfinished()
    messages.set(itemId, {before: shown, text, done})
    shown += text
    last = itemId

    if (dropped) return [{...ids, type: 'TEXT_REPLACE', text: shown}]

    return text === '' ? [] : [{...ids, type: 'TEXT_DELTA', delta: text}]
  }

  function onDelta(itemId: string, delta: string): ContentEvent[] {
    const message = messages.get(itemId)

    if (!message) return addMessage(itemId, delta, false)

    if (last !== itemId) return []

    message.text += delta
    shown += delta

    return [{...ids, type: 'TEXT_DELTA', delta}]
  }

  function onMessage(itemId: string, text: string): ContentEvent[] {
    const message = messages.get(itemId)

    if (!message) return addMessage(itemId, text, true)

    message.done = true

    // A later message started and dropped this one, so its finish changes nothing.
    if (message.text === text || last !== itemId) return []

    message.text = text
    shown = message.before + text

    return [{...ids, type: 'TEXT_REPLACE', text: shown}]
  }

  /** A message cut short before a tool call stays as it is. */
  function startToolCall(item: ToolItem): ContentEvent[] {
    toolCalls.add(item.id)
    shown = ''
    last = null

    return [
      {
        ...ids,
        type: 'TOOL_CALL_START',
        toolCallId: item.id,
        toolName: item.type,
      },
      {
        ...ids,
        type: 'TOOL_CALL_ARGS',
        toolCallId: item.id,
        delta: JSON.stringify(argsOf(item)),
      },
    ]
  }

  function finishToolCall(item: ToolItem): ContentEvent[] {
    const started = toolCalls.has(item.id) ? [] : startToolCall(item)

    return [
      ...started,
      {...ids, type: 'TOOL_RESULT', toolCallId: item.id, ...resultOf(item)},
    ]
  }

  function onItemCompleted(item: Item, threadId: string): ContentEvent[] {
    const tool = toolItemOf(item)

    if (tool) return finishToolCall(tool)

    if (item.type === CONTEXT_COMPACTION) {
      return [
        {
          ...ids,
          type: 'CONTEXT_COMPACTED',
          sessionId: threadId,
          boundaryId: null,
        },
      ]
    }

    const message = AgentMessageItemSchema.safeParse(item)

    return message.success ? onMessage(message.data.id, message.data.text) : []
  }

  return {
    map(notification: Notification): ContentEvent[] {
      const {method, params} = notification

      if (method === 'error') {
        if (!params.willRetry) return []

        retryErrorInfo = params.error.codexErrorInfo

        return [
          {
            ...ids,
            type: 'RECONNECTING',
            busy: isBusyStatus(params.error.httpStatusCode),
          },
        ]
      }

      if (method === 'item/agentMessage/delta') {
        return onDelta(params.itemId, params.delta)
      }

      if (method === 'item/started') {
        const tool = toolItemOf(params.item)

        return tool && !toolCalls.has(tool.id) ? startToolCall(tool) : []
      }

      if (method === 'item/completed') {
        return onItemCompleted(params.item, params.threadId)
      }

      if (
        method === 'item/reasoning/summaryTextDelta' ||
        method === 'item/reasoning/textDelta'
      ) {
        return [{...ids, type: 'REASONING_DELTA', delta: params.delta}]
      }

      if (method !== 'thread/tokenUsage/updated') return []

      const {last: usage, modelContextWindow} = params.tokenUsage

      const tokens: ContentEvent = {
        ...ids,
        type: 'TOKENS',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        contextSize: usage.totalTokens,
      }

      return [
        modelContextWindow !== null && modelContextWindow > 0
          ? {...tokens, contextWindow: modelContextWindow}
          : tokens,
      ]
    },

    /** `resetsAt` is in seconds since the epoch. */
    finished(turn: CodexTurn, resetsAt?: number): RunFinished {
      if (turn.status === 'completed') {
        return {...ids, type: 'RUN_FINISHED', status: 'complete'}
      }

      if (turn.status === 'interrupted') {
        return {...ids, type: 'RUN_FINISHED', status: 'stopped'}
      }

      return {
        ...ids,
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: codexFailureOf(
          turn.error?.message ?? 'ChatGPT couldn’t finish this Reply.',
          {resetsAt, retryErrorInfo, codexErrorInfo: turn.error?.codexErrorInfo}
        ),
      }
    },
  }
}

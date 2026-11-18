import type {ClaudeSignals} from '#modules/failures/main'
import type {ContentEvent} from '#modules/reply-runs/main'
import type {
  ModelUsage,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {claudeFailureOf, isBusyStatus} from '#modules/failures/main'
import {z} from 'zod'

type StreamEvent = SDKPartialAssistantMessage['event']

type BlockDelta = Extract<StreamEvent, {type: 'content_block_delta'}>['delta']

type MessageUsage = Extract<StreamEvent, {type: 'message_delta'}>['usage']

type RunFinished = Extract<ReplyEvent, {type: 'RUN_FINISHED'}>

type AssistantPart = SDKAssistantMessage['message']['content'][number]

type ToolUse = Extract<AssistantPart, {type: 'tool_use'}>

type ToolResultContent = Extract<
  Exclude<SDKUserMessage['message']['content'], string>[number],
  {type: 'tool_result'}
>['content']

/** What `claude` names the Model of a message it made up, such as an error. */
const SYNTHETIC_MODEL = '<synthetic>'

type ReplyIds = Pick<ReplyRequest, 'treeId' | 'replyId'>

/** Where a message `claude` cut off starts over, and the tool calls it drops. */
interface Cut {
  text: string
  toolCalls: string[]
}

/**
 * Not in the SDK's types: how `claude` ends a message cut off mid-stream, on
 * the `stream_event` beside its `message_stop`.
 */
const AbandonedStopSchema = z.looseObject({
  abandoned_blocks: z.looseObject({
    from_block_index: z.number().int().nonnegative(),
  }),
})

/** A result's text; an image or a document in it is named, not shown. */
function resultText(content: ToolResultContent) {
  if (!Array.isArray(content)) return content ?? ''

  return content
    .map(part => (part.type === 'text' ? part.text : `[${part.type}]`))
    .join('\n')
}

/**
 * Turns one Reply's SDK messages into contract events. A message that broke
 * and was sent again is cut back, tool calls and all, as the new one starts;
 * Subagent messages are left out. The text tracked is the current text part's,
 * which a tool call ends.
 */
export function createReplyMapper(ids: ReplyIds) {
  let shown = ''
  let atMessageStart = ''
  let atBlockStart = ''
  let block: string | null = null
  /** The text shown as each block of the open message began, by index. */
  let blockStarts: string[] = []
  let messageOpen = false
  /** Where the blocks `claude` cut off, and will send again, began. */
  let atCut: Cut | null = null
  let mirrorFailed = false
  let lastMessage: {uuid: string; model: string} | null = null
  const signals: ClaudeSignals = {}
  const toolCalls = new Set<string>()
  /** The tool call each block of the open message streams, by index. */
  let toolBlocks: string[] = []

  function replace(text: string): ContentEvent[] {
    if (text === shown) return []

    shown = text

    return [{...ids, type: 'TEXT_REPLACE', text}]
  }

  function startToolCall({id, name}: ToolUse): ContentEvent[] {
    toolCalls.add(id)
    shown = ''

    return [{...ids, type: 'TOOL_CALL_START', toolCallId: id, toolName: name}]
  }

  /** From block `index` of the open message, which began with `text` shown. */
  function cutFrom(index: number, text: string): Cut {
    return {text, toolCalls: toolBlocks.slice(index).filter(Boolean)}
  }

  function cutBack({text, toolCalls: dropped}: Cut): ContentEvent[] {
    const [toolCallId] = dropped

    if (toolCallId === undefined) return replace(text)

    for (const id of dropped) toolCalls.delete(id)
    shown = text

    return [{...ids, type: 'CONTENT_CUT_BACK', toolCallId, text}]
  }

  function onDelta(delta: BlockDelta, index: number): ContentEvent[] {
    if (delta.type === 'text_delta') {
      block = (block ?? '') + delta.text
      shown += delta.text

      return [{...ids, type: 'TEXT_DELTA', delta: delta.text}]
    }

    if (delta.type === 'thinking_delta') {
      return [{...ids, type: 'REASONING_DELTA', delta: delta.thinking}]
    }

    const toolCallId = toolBlocks[index]

    if (delta.type === 'input_json_delta' && toolCallId !== undefined) {
      return [
        {...ids, type: 'TOOL_CALL_ARGS', toolCallId, delta: delta.partial_json},
      ]
    }

    return []
  }

  /** As this request's own usage reports it: what it sent and wrote. */
  function tokens(usage: MessageUsage): ContentEvent {
    const inputTokens =
      (usage.input_tokens ?? 0) +
      (usage.cache_creation_input_tokens ?? 0) +
      (usage.cache_read_input_tokens ?? 0)

    return {
      ...ids,
      type: 'TOKENS',
      inputTokens,
      outputTokens: usage.output_tokens,
      contextSize: inputTokens + usage.output_tokens,
    }
  }

  function onStreamEvent(message: SDKPartialAssistantMessage): ContentEvent[] {
    const {event} = message

    if (event.type === 'message_start') {
      // A message that never stopped was cut off and is being sent again.
      const cut = messageOpen ? cutFrom(0, atMessageStart) : atCut
      const resent = cut === null ? [] : cutBack(cut)
      messageOpen = true
      atMessageStart = shown
      blockStarts = []
      toolBlocks = []
      atCut = null

      return resent
    }

    if (event.type === 'content_block_start') {
      blockStarts[event.index] = shown

      if (event.content_block.type === 'text') {
        atBlockStart = shown
        block = ''
      }

      if (event.content_block.type === 'tool_use') {
        toolBlocks[event.index] = event.content_block.id

        return startToolCall(event.content_block)
      }

      return []
    }

    if (event.type === 'content_block_delta') {
      return onDelta(event.delta, event.index)
    }

    if (event.type === 'message_delta') return [tokens(event.usage)]

    if (event.type === 'content_block_stop') {
      block = null

      return []
    }

    onMessageStop(message)

    return []
  }

  /** The blocks before the first one `claude` threw away stay in the session. */
  function onMessageStop(message: SDKPartialAssistantMessage) {
    messageOpen = false
    const stop = AbandonedStopSchema.safeParse(message)

    if (!stop.success) return

    const from = stop.data.abandoned_blocks.from_block_index
    atCut = cutFrom(from, blockStarts[from] ?? shown)
  }

  /** `claude` reports the context window only with the result, per Model. */
  function contextWindowOf(modelUsage: Record<string, ModelUsage>) {
    const entries = Object.values(modelUsage)

    const usage =
      (lastMessage && modelUsage[lastMessage.model]) ??
      (entries.length === 1 ? entries[0] : undefined)

    const contextWindow = usage?.contextWindow

    return contextWindow !== undefined && contextWindow > 0
      ? contextWindow
      : undefined
  }

  function textOf(content: AssistantPart[]): ContentEvent[] {
    const text = content
      .flatMap(part => (part.type === 'text' ? [part.text] : []))
      .join('')

    if (block === null) {
      if (text === '') return []

      shown += text

      return [{...ids, type: 'TEXT_DELTA', delta: text}]
    }

    if (text === block) return []

    block = text

    return replace(atBlockStart + text)
  }

  /** A tool call streamed has started already; one that wasn't starts whole. */
  function unstreamedToolCalls(content: AssistantPart[]): ContentEvent[] {
    return content.flatMap(part =>
      part.type === 'tool_use' && !toolCalls.has(part.id)
        ? [
            ...startToolCall(part),
            {
              ...ids,
              type: 'TOOL_CALL_ARGS' as const,
              toolCallId: part.id,
              delta: JSON.stringify(part.input),
            },
          ]
        : []
    )
  }

  function onAssistant({
    message,
    uuid,
    error,
  }: SDKAssistantMessage): ContentEvent[] {
    signals.assistantError = error

    if (message.model === SYNTHETIC_MODEL) return []

    lastMessage = {uuid, model: message.model}

    return [...textOf(message.content), ...unstreamedToolCalls(message.content)]
  }

  function onToolResults({message}: SDKUserMessage): ContentEvent[] {
    if (!Array.isArray(message.content)) return []

    return message.content.flatMap(part =>
      part.type === 'tool_result' && toolCalls.has(part.tool_use_id)
        ? [
            {
              ...ids,
              type: 'TOOL_RESULT' as const,
              toolCallId: part.tool_use_id,
              content: resultText(part.content),
              isError: part.is_error === true,
            },
          ]
        : []
    )
  }

  function trackState(message: SDKMessage) {
    if (message.type === 'rate_limit_event') {
      const {status, resetsAt} = message.rate_limit_info
      signals.rejectedLimit = status === 'rejected' ? {resetsAt} : undefined
    }

    if (message.type !== 'system') return

    if (message.subtype === 'mirror_error') mirrorFailed = true

    if (message.subtype === 'api_retry') {
      signals.retryStatus = message.error_status
    }

    if (message.subtype === 'status' && message.compact_result !== undefined) {
      signals.compactionFailed = message.compact_result === 'failed'
    }
  }

  return {
    map(message: SDKMessage): ContentEvent[] {
      trackState(message)

      if (message.type === 'system' && message.subtype === 'api_retry') {
        return [
          {
            ...ids,
            type: 'RECONNECTING',
            busy: isBusyStatus(message.error_status),
          },
        ]
      }

      // The only sign a compaction went through: one blocked or failed sends none.
      if (message.type === 'system' && message.subtype === 'compact_boundary') {
        return [
          {
            ...ids,
            type: 'CONTEXT_COMPACTED',
            sessionId: message.session_id,
            boundaryId: message.uuid,
          },
        ]
      }

      if (!('parent_tool_use_id' in message)) return []

      if (message.parent_tool_use_id !== null) return []

      if (message.type === 'stream_event') return onStreamEvent(message)

      if (message.type === 'assistant') return onAssistant(message)

      if (message.type === 'user') return onToolResults(message)

      return []
    },

    finished(result: SDKResultMessage): RunFinished {
      const contextWindow = contextWindowOf(result.modelUsage)
      const windowField = contextWindow === undefined ? {} : {contextWindow}

      // A stopped turn’s result comes with either subtype and either
      // `is_error`, partial text or not; only `terminal_reason` tells.
      if (
        result.terminal_reason === 'aborted_streaming' ||
        result.terminal_reason === 'aborted_tools'
      ) {
        return {...ids, ...windowField, type: 'RUN_FINISHED', status: 'stopped'}
      }

      if (result.subtype === 'success' && !result.is_error) {
        return {
          ...ids,
          ...windowField,
          type: 'RUN_FINISHED',
          status: 'complete',
        }
      }

      const message =
        result.subtype === 'success' ? result.result : result.errors.join(' ')

      return {
        ...ids,
        ...windowField,
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: claudeFailureOf(
          message || 'Claude couldn’t finish this Reply.',
          {
            ...signals,
            terminalReason: result.terminal_reason,
            apiErrorStatus:
              result.subtype === 'success'
                ? result.api_error_status
                : undefined,
          }
        ),
      }
    },

    /** Null when an entry didn't reach the app's copy of the session. */
    recorded() {
      return mirrorFailed ? null : lastMessage
    },
  }
}

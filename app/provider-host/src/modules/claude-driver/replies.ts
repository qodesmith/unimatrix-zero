import type {ContentEvent} from '#modules/reply-runs/main'
import type {
  ModelUsage,
  SDKAssistantMessage,
  SDKMessage,
  SDKPartialAssistantMessage,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {failureOf} from '#modules/failures/main'
import {z} from 'zod'

type StreamEvent = SDKPartialAssistantMessage['event']

type BlockDelta = Extract<StreamEvent, {type: 'content_block_delta'}>['delta']

type MessageUsage = Extract<StreamEvent, {type: 'message_delta'}>['usage']

type RunFinished = Extract<ReplyEvent, {type: 'RUN_FINISHED'}>

/** What `claude` names the Model of a message it made up, such as an error. */
const SYNTHETIC_MODEL = '<synthetic>'

type ReplyIds = Pick<ReplyRequest, 'treeId' | 'replyId'>

/**
 * Not in the SDK's types: how `claude` ends a message cut off mid-stream, on
 * the `stream_event` beside its `message_stop`.
 */
const AbandonedStopSchema = z.looseObject({
  abandoned_blocks: z.looseObject({
    from_block_index: z.number().int().nonnegative(),
  }),
})

/**
 * Turns one Reply's SDK messages into contract events. A message that broke
 * and was sent again has its text replaced as the new one starts; Subagent
 * messages are left out.
 */
export function createReplyMapper(ids: ReplyIds) {
  let shown = ''
  let atMessageStart = ''
  let atBlockStart = ''
  let block: string | null = null
  /** The text shown as each block of the open message began, by index. */
  let blockStarts: string[] = []
  let messageOpen = false
  /** Where a message `claude` cut off and will start over ends the text. */
  let cutAt: string | null = null
  let mirrorFailed = false
  let lastMessage: {uuid: string; model: string} | null = null
  let limitLifts: number | undefined
  let limitRejected = false

  function replace(text: string): ContentEvent[] {
    if (text === shown) return []

    shown = text

    return [{...ids, type: 'TEXT_REPLACE', text}]
  }

  function onDelta(delta: BlockDelta): ContentEvent[] {
    if (delta.type === 'text_delta') {
      block = (block ?? '') + delta.text
      shown += delta.text

      return [{...ids, type: 'TEXT_DELTA', delta: delta.text}]
    }

    if (delta.type === 'thinking_delta') {
      return [{...ids, type: 'REASONING_DELTA', delta: delta.thinking}]
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
      const from = messageOpen ? atMessageStart : cutAt
      const resent = from === null ? [] : replace(from)
      messageOpen = true
      atMessageStart = shown
      blockStarts = []
      cutAt = null

      return resent
    }

    if (event.type === 'content_block_start') {
      blockStarts[event.index] = shown

      if (event.content_block.type === 'text') {
        atBlockStart = shown
        block = ''
      }

      return []
    }

    if (event.type === 'content_block_delta') return onDelta(event.delta)

    if (event.type === 'message_delta') return [tokens(event.usage)]

    if (event.type === 'content_block_stop') block = null
    else onMessageStop(message)

    return []
  }

  /** The blocks before the first one `claude` threw away stay in the session. */
  function onMessageStop(message: SDKPartialAssistantMessage) {
    messageOpen = false
    const stop = AbandonedStopSchema.safeParse(message)

    if (stop.success) {
      const from = stop.data.abandoned_blocks.from_block_index
      cutAt = blockStarts[from] ?? shown
    }
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

  function onAssistant({message, uuid}: SDKAssistantMessage): ContentEvent[] {
    if (message.model === SYNTHETIC_MODEL) return []

    lastMessage = {uuid, model: message.model}

    const text = message.content
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

  return {
    map(message: SDKMessage): ContentEvent[] {
      if (message.type === 'system' && message.subtype === 'mirror_error') {
        mirrorFailed = true
      }

      if (message.type === 'system' && message.subtype === 'api_retry') {
        return [{...ids, type: 'RECONNECTING'}]
      }

      if (message.type === 'rate_limit_event') {
        const {status, resetsAt} = message.rate_limit_info
        limitRejected = status === 'rejected'
        limitLifts = limitRejected ? resetsAt : undefined
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
        failure: failureOf(message || 'Claude couldn’t finish this Reply.', {
          resetsAt: limitLifts,
          limitRejected,
          terminalReason: result.terminal_reason,
        }),
      }
    },

    /** Null when an entry didn't reach the app's copy of the session. */
    recorded() {
      return mirrorFailed ? null : lastMessage
    },
  }
}

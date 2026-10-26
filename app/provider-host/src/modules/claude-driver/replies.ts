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

type StreamEvent = SDKPartialAssistantMessage['event']

type BlockDelta = Extract<StreamEvent, {type: 'content_block_delta'}>['delta']

type MessageUsage = Extract<StreamEvent, {type: 'message_delta'}>['usage']

type RunFinished = Extract<ReplyEvent, {type: 'RUN_FINISHED'}>

/** What `claude` names the Model of a message it made up, such as an error. */
const SYNTHETIC_MODEL = '<synthetic>'

type ReplyIds = Pick<ReplyRequest, 'treeId' | 'replyId'>

/**
 * Turns one Reply's SDK messages into contract events. A stream that broke and
 * was silently resent has its text replaced; Subagent messages are left out.
 */
export function createReplyMapper(ids: ReplyIds) {
  /** The current text part's text, as the events so far show it. */
  let shown = ''
  let atMessageStart = ''
  let atBlockStart = ''
  let block: string | null = null
  let messageOpen = false
  let mirrorFailed = false
  let lastMessage: {uuid: string; model: string} | null = null
  /** When the limit refusing Claude's requests lifts; undefined while none does. */
  let limitLifts: number | undefined

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

  function onStreamEvent(event: StreamEvent): ContentEvent[] {
    if (event.type === 'message_start') {
      // A message that never stopped was cut off and is being sent again.
      const resent = messageOpen ? replace(atMessageStart) : []
      messageOpen = true
      atMessageStart = shown

      return resent
    }

    if (event.type === 'content_block_start') {
      if (event.content_block.type === 'text') {
        atBlockStart = shown
        block = ''
      }

      return []
    }

    if (event.type === 'content_block_delta') return onDelta(event.delta)

    if (event.type === 'message_delta') return [tokens(event.usage)]

    if (event.type === 'content_block_stop') block = null
    else messageOpen = false

    return []
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

      if (message.type === 'rate_limit_event') {
        const {status, resetsAt} = message.rate_limit_info
        limitLifts = status === 'rejected' ? resetsAt : undefined
      }

      if (!('parent_tool_use_id' in message)) return []

      if (message.parent_tool_use_id !== null) return []

      if (message.type === 'stream_event') return onStreamEvent(message.event)

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
        failure: failureOf(
          message || 'Claude couldn’t finish this Reply.',
          limitLifts
        ),
      }
    },

    /** Null when an entry didn't reach the app's copy of the session. */
    recorded() {
      return mirrorFailed ? null : lastMessage
    },
  }
}

import type {ContentEvent} from '#modules/reply-runs/main'
import type {Notification} from './wire'
import type {ReplyRequest} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {failureOf} from '#modules/failures/main'

import {AgentMessageItemSchema} from './wire'

type ReplyIds = Pick<ReplyRequest, 'treeId' | 'replyId'>

type RunFinished = Extract<ReplyEvent, {type: 'RUN_FINISHED'}>

type CodexTurn = Extract<
  Notification,
  {method: 'turn/completed'}
>['params']['turn']

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
 * Reasoning is passed on for display and never kept.
 */
export function createReplyMapper(ids: ReplyIds) {
  let shown = ''

  const messages = new Map<
    string,
    {before: string; text: string; done: boolean}
  >()

  let last: string | null = null

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

    message.text += delta
    shown += delta
    last = itemId

    return [{...ids, type: 'TEXT_DELTA', delta}]
  }

  function onMessage(itemId: string, text: string): ContentEvent[] {
    const message = messages.get(itemId)

    if (!message) return addMessage(itemId, text, true)

    message.done = true

    // A later message has streamed since, so this one stands as shown.
    if (message.text === text || last !== itemId) return []

    message.text = text
    shown = message.before + text

    return [{...ids, type: 'TEXT_REPLACE', text: shown}]
  }

  return {
    map(notification: Notification): ContentEvent[] {
      const {method, params} = notification

      if (method === 'item/agentMessage/delta') {
        return onDelta(params.itemId, params.delta)
      }

      if (method === 'item/completed') {
        const message = AgentMessageItemSchema.safeParse(params.item)

        return message.success
          ? onMessage(message.data.id, message.data.text)
          : []
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
        failure: failureOf(
          turn.error?.message ?? 'ChatGPT couldn’t finish this Reply.',
          resetsAt
        ),
      }
    },
  }
}

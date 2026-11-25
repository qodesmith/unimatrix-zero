import type {ApprovalEvent} from '#modules/approvals/main'
import type {SDKMessage} from '@anthropic-ai/claude-agent-sdk'

export type Fed =
  | {kind: 'message'; message: SDKMessage}
  | {kind: 'approval'; event: ApprovalEvent}

/**
 * A Reply's messages with the approval events `claude`'s callback raises in
 * between. The SDK calls back as it reads, maybe before the Reply has taken
 * the messages read before, so a card waits until its tool call's message is
 * taken.
 */
export function createApprovalFeed() {
  const held: ApprovalEvent[] = []
  const taken = new Set<string>()
  let arrived = Promise.withResolvers<'arrived'>()

  function ready(event: ApprovalEvent) {
    return (
      event.type !== 'APPROVAL_REQUESTED' ||
      event.toolCallId === undefined ||
      taken.has(event.toolCallId)
    )
  }

  function* release(): Generator<Fed> {
    for (;;) {
      const [event] = held

      if (!event || !ready(event)) return

      held.shift()
      yield {kind: 'approval', event}
    }
  }

  function emit(event: ApprovalEvent) {
    held.push(event)
    arrived.resolve('arrived')
  }

  function take(message: SDKMessage) {
    if (message.type !== 'assistant' || message.parent_tool_use_id !== null) {
      return
    }

    for (const part of message.message.content) {
      if (part.type === 'tool_use') taken.add(part.id)
    }
  }

  return {
    emit,

    async *merge(messages: AsyncGenerator<SDKMessage>): AsyncGenerator<Fed> {
      let next = messages.next()

      try {
        for (;;) {
          yield* release()

          const step = await Promise.race([next, arrived.promise])

          if (step === 'arrived') {
            arrived = Promise.withResolvers()
            continue
          }

          if (step.done) return

          yield {kind: 'message', message: step.value}
          take(step.value)
          next = messages.next()
        }
      } finally {
        next.catch(() => undefined)
        messages.return(undefined).catch(() => undefined)
      }
    },
  }
}

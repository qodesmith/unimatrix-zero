import type {ReplyEvent} from '@uz/contract/turns'

import {createFakeDriver} from '@uz/provider-host/fake-driver'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

/** The fake Reply's events, kept where the window's tests replay them. */
export const FAKE_REPLY_RECORDING = path.join(
  root,
  'app/renderer/src/modules/turns/fake-reply.json'
)

const RECORDED_IDS = {
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
}

/** Tool call ids are numbered so two recordings come out the same. */
export async function recordFakeReply(): Promise<ReplyEvent[]> {
  const driver = createFakeDriver({delayMs: 0})
  const toolCallIds = new Map<string, string>()

  function numbered(toolCallId: string) {
    const known = toolCallIds.get(toolCallId)

    if (known) return known

    const next = `tool-${toolCallIds.size + 1}`
    toolCallIds.set(toolCallId, next)

    return next
  }

  const events: ReplyEvent[] = []

  for await (const event of driver.startReply({
    ...RECORDED_IDS,
    model: 'fake',
    systemPrompt: '',
    prompt: {text: 'Show me everything'},
    vendorProgram: {program: null, configDir: '/fake'},
    session: null,
  })) {
    if (event.type === 'REPLY_RECORDED') continue

    events.push(
      'toolCallId' in event && event.toolCallId !== undefined
        ? {...event, toolCallId: numbered(event.toolCallId)}
        : event
    )
  }

  return events
}

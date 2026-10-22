import type {ReplyRecorded} from '@uz/contract/host'
import type {ReplyEvent} from '@uz/contract/turns'

import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {expect, it} from 'vitest'

import {createFakeDriver} from './main'

const request = {
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
  model: 'fake',
  systemPrompt: '',
  vendorProgram: {program: null, configDir: '/claude'},
  session: null,
}

type Streamed = ReplyEvent | ReplyRecorded

async function collect(events: AsyncIterable<Streamed>) {
  return Array.fromAsync(events)
}

function textOf(events: Streamed[]) {
  return events
    .flatMap(event => (event.type === 'REPLY_RECORDED' ? [] : [event]))
    .reduce(foldReplyEvent, NEW_REPLY)
    .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('')
}

function textDeltas(events: Streamed[]) {
  return events.filter(event => event.type === 'TEXT_DELTA').length
}

it('streams canned Markdown word by word around a tool call, then tokens', async () => {
  const driver = createFakeDriver({delayMs: 0})

  const events = await collect(
    driver.startReply({...request, prompt: {text: 'Tell me something'}})
  )

  const types = events.map(event => event.type)
  expect(types[0]).toBe('RUN_STARTED')
  expect(textDeltas(events)).toBeGreaterThan(20)
  expect(types).toContain('TOOL_RESULT')
  expect(types.slice(-3)).toEqual(['TOKENS', 'REPLY_RECORDED', 'RUN_FINISHED'])
  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(textOf(events)).toContain("That's the end of the fake Reply.")
})

it('thinks before the first word, with everything a Reply can show', async () => {
  const driver = createFakeDriver({delayMs: 0})

  const events = await collect(
    driver.startReply({...request, prompt: {text: 'Show me everything'}})
  )

  const types = events.map(event => event.type)
  const firstThought = types.indexOf('REASONING_DELTA')
  expect(firstThought).toBe(1)
  expect(firstThought).toBeLessThan(types.indexOf('TEXT_DELTA'))

  const text = textOf(events)
  expect(text).toContain('```ts\n')
  expect(text).toContain('$$\n')
  expect(text).toContain('```mermaid\n')
  expect(text).toContain('](https://example.com/fake-reply-path.png)')
})

it('fails partway when the Prompt asks it to', async () => {
  const driver = createFakeDriver({delayMs: 0})

  const events = await collect(
    driver.startReply({...request, prompt: {text: 'Please /fail'}})
  )

  expect(textOf(events)).not.toBe('')
  expect(events.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'failed',
    failure: {code: 'fake-failure'},
  })
})

it('hangs partway when the Prompt asks it to, until stopped', async () => {
  const driver = createFakeDriver({delayMs: 0})
  const events: Streamed[] = []

  const done = (async () => {
    for await (const event of driver.startReply({
      ...request,
      prompt: {text: 'Please /hang'},
    })) {
      events.push(event)

      if (textDeltas(events) === 12) {
        setTimeout(() => void driver.stop(request.replyId), 20)
      }
    }
  })()

  await done

  expect(textOf(events)).not.toBe('')
  expect(events.filter(event => event.type === 'TEXT_DELTA')).toHaveLength(12)
  expect(events.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'stopped',
  })
})

it('stops a hanging Reply that was stopped on its last word', async () => {
  const driver = createFakeDriver({delayMs: 0})
  const events: Streamed[] = []

  for await (const event of driver.startReply({
    ...request,
    prompt: {text: 'Please /hang'},
  })) {
    events.push(event)

    if (textDeltas(events) === 12) await driver.stop(request.replyId)
  }

  expect(events.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'stopped',
  })
}, 1000)

it('records each Reply in the session it continues, or a new one', async () => {
  const driver = createFakeDriver({delayMs: 0})
  const prompt = {text: 'Hi'}

  const first = await collect(driver.startReply({...request, prompt}))
  const recorded = first.find(event => event.type === 'REPLY_RECORDED')

  if (!recorded) throw new Error('The Reply was not recorded')

  const next = await collect(
    driver.startReply({
      ...request,
      prompt,
      session: {...recorded.session},
    })
  )

  expect(next).toContainEqual(
    expect.objectContaining({
      type: 'REPLY_RECORDED',
      session: {
        sessionId: recorded.session.sessionId,
        messageId: expect.not.stringMatching(recorded.session.messageId),
      },
    })
  )
})

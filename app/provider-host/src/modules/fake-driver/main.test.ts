import type {ReplyEvent} from '@uz/contract/turns'

import {NEW_REPLY, foldReplyEvent} from '@uz/contract/turns'
import {expect, it} from 'vitest'

import {createFakeDriver} from './main'

const request = {
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
  model: 'fake',
  systemPrompt: '',
}

async function collect(events: AsyncIterable<ReplyEvent>) {
  return Array.fromAsync(events)
}

function textOf(events: ReplyEvent[]) {
  return events
    .reduce(foldReplyEvent, NEW_REPLY)
    .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('')
}

it('streams canned Markdown word by word around a tool call, then tokens', async () => {
  const driver = createFakeDriver({delayMs: 0})

  const events = await collect(
    driver.startReply({...request, prompt: {text: 'Tell me something'}})
  )

  const types = events.map(event => event.type)
  expect(types[0]).toBe('RUN_STARTED')
  expect(types.filter(type => type === 'TEXT_DELTA').length).toBeGreaterThan(20)
  expect(types).toContain('TOOL_RESULT')
  expect(types.slice(-2)).toEqual(['TOKENS', 'RUN_FINISHED'])
  expect(events.at(-1)).toMatchObject({status: 'complete'})
  expect(textOf(events)).toContain("That's the end of the fake Reply.")
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
  const events: ReplyEvent[] = []

  const done = (async () => {
    for await (const event of driver.startReply({
      ...request,
      prompt: {text: 'Please /hang'},
    })) {
      events.push(event)

      if (event.type === 'TEXT_DELTA' && events.length === 13) {
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
  const events: ReplyEvent[] = []

  for await (const event of driver.startReply({
    ...request,
    prompt: {text: 'Please /hang'},
  })) {
    events.push(event)

    if (event.type === 'TEXT_DELTA' && events.length === 13) {
      await driver.stop(request.replyId)
    }
  }

  expect(events.at(-1)).toMatchObject({
    type: 'RUN_FINISHED',
    status: 'stopped',
  })
}, 1000)

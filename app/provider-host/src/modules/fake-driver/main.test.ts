import type {StartReplyEvent} from '@uz/contract/host'

import {isReplyEvent} from '@uz/contract/host'
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

type Streamed = StartReplyEvent

async function collect(events: AsyncIterable<Streamed>) {
  return Array.fromAsync(events)
}

function textOf(events: Streamed[]) {
  return events
    .filter(isReplyEvent)
    .reduce(foldReplyEvent, NEW_REPLY)
    .content.flatMap(part => (part.type === 'text' ? [part.text] : []))
    .join('')
}

function textDeltas(events: Streamed[]) {
  return events.filter(event => event.type === 'TEXT_DELTA').length
}

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
})

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
      session: {...recorded.session, type: 'continue'},
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

it('records each Reply on the Model it was asked for', async () => {
  const driver = createFakeDriver({delayMs: 0})

  const events = await collect(
    driver.startReply({...request, model: 'fake-pro', prompt: {text: 'Hi'}})
  )

  expect(events).toContainEqual(
    expect.objectContaining({type: 'REPLY_RECORDED', model: 'fake-pro'})
  )
})

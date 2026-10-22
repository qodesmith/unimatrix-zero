import type {HostPort} from './main'
import type {HostMessage, ProviderDriver} from '@uz/contract/host'

import {createFakeDriver} from '#modules/fake-driver/main'
import {expect, it, vi} from 'vitest'

import {runHost} from './main'

const request = {
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
  model: 'fake',
  systemPrompt: '',
  prompt: {text: 'Hi'},
}

/** Main as the host sees it: sends commands and keeps what it was sent. */
function fakeMain() {
  const sent: HostMessage[] = []
  const listeners: ((event: {data: unknown}) => void)[] = []

  const port: HostPort = {
    postMessage: message => sent.push(message),
    on: (_event, listener) => listeners.push(listener),
  }

  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- tests send malformed commands too
  function command(data: unknown) {
    for (const listener of listeners) listener({data})
  }

  return {port, sent, command}
}

async function tick() {
  await new Promise(resolve => {
    setTimeout(resolve, 10)
  })
}

async function finished(sent: HostMessage[]) {
  await vi.waitFor(() => {
    expect(sent.at(-1)?.type).toBe('RUN_FINISHED')
  })
}

it('says it is ready with the driver’s Models', async () => {
  const main = fakeMain()
  await runHost(main.port, createFakeDriver({delayMs: 0}))

  expect(main.sent).toEqual([
    {type: 'HOST_READY', models: [{id: 'fake', name: 'Fake model'}]},
  ])
})

it('streams a requested Reply back to main', async () => {
  const main = fakeMain()
  await runHost(main.port, createFakeDriver({delayMs: 0}))

  main.command({type: 'reply.start', request})
  await finished(main.sent)

  expect(main.sent[1]).toEqual({
    type: 'RUN_STARTED',
    treeId: request.treeId,
    replyId: request.replyId,
  })
  expect(main.sent.at(-1)).toMatchObject({status: 'complete'})
})

it('drops a command that does not parse', async () => {
  const main = fakeMain()
  await runHost(main.port, createFakeDriver({delayMs: 0}))

  main.command({type: 'reply.start', request: {...request, extra: true}})
  await tick()

  expect(main.sent.map(message => message.type)).toEqual(['HOST_READY'])
})

it('fails the Reply when the driver throws', async () => {
  const main = fakeMain()

  const driver: ProviderDriver = {
    ...createFakeDriver({delayMs: 0}),
    // oxlint-disable-next-line require-yield -- a driver that breaks before its first event
    async *startReply() {
      throw new Error('vendor program missing')
    },
  }

  await runHost(main.port, driver)

  main.command({type: 'reply.start', request})
  await finished(main.sent)

  expect(main.sent.at(-1)).toEqual({
    type: 'RUN_FINISHED',
    treeId: request.treeId,
    replyId: request.replyId,
    status: 'failed',
    failure: {code: 'driver-error', message: 'vendor program missing'},
  })
})

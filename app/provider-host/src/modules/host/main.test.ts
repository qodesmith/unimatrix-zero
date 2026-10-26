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
  vendorProgram: {program: null, configDir: '/claude'},
  session: null,
}

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
  await runHost(main.port, () => createFakeDriver({delayMs: 0}))

  expect(main.sent).toEqual([
    {type: 'HOST_READY', models: [{id: 'fake', name: 'Fake model'}]},
  ])
})

it('streams a requested Reply back to main', async () => {
  const main = fakeMain()
  await runHost(main.port, () => createFakeDriver({delayMs: 0}))

  main.command({type: 'reply.start', request})
  await finished(main.sent)

  expect(main.sent[1]).toEqual({
    type: 'RUN_STARTED',
    treeId: request.treeId,
    replyId: request.replyId,
  })
  expect(main.sent.at(-1)).toMatchObject({status: 'complete'})
})

it('stops a Reply on main’s word, keeping the text so far', async () => {
  const main = fakeMain()
  await runHost(main.port, () => createFakeDriver({delayMs: 1}))

  main.command({
    type: 'reply.start',
    request: {...request, prompt: {text: 'Please /hang'}},
  })
  await vi.waitFor(() => {
    expect(
      main.sent.filter(message => message.type === 'TEXT_DELTA').length
    ).toBeGreaterThan(3)
  })

  main.command({type: 'reply.stop', replyId: request.replyId})
  await finished(main.sent)

  expect(main.sent.at(-1)).toMatchObject({status: 'stopped'})
})

it('drops a command that does not parse', async () => {
  const main = fakeMain()
  await runHost(main.port, () => createFakeDriver({delayMs: 0}))

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

  await runHost(main.port, () => driver)

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

const signInRequest = {program: null, configDir: '/nowhere'}

async function lastStep(sent: HostMessage[], step: string) {
  await vi.waitFor(() => {
    expect(sent.at(-1)).toMatchObject({step})
  })
}

async function signInFinished(sent: HostMessage[]) {
  await vi.waitFor(() => {
    expect(sent.at(-1)?.type).toBe('SIGN_IN_FINISHED')
  })
}

it('streams each step of connecting back to main', async () => {
  const main = fakeMain()
  await runHost(main.port, () =>
    createFakeDriver({delayMs: 0, signInAnswerMs: null})
  )

  main.command({type: 'sign-in.start', request: signInRequest})
  await lastStep(main.sent, 'sign-in-page')
  main.command({type: 'sign-in.page-opened'})
  await lastStep(main.sent, 'paste-code')
  main.command({type: 'sign-in.code', code: 'fake-code'})
  await signInFinished(main.sent)

  expect(main.sent.at(-1)).toMatchObject({outcome: 'connected'})
})

it('passes a cancel on to the driver', async () => {
  const main = fakeMain()
  await runHost(main.port, () =>
    createFakeDriver({delayMs: 0, signInAnswerMs: null})
  )

  main.command({type: 'sign-in.start', request: signInRequest})
  await lastStep(main.sent, 'sign-in-page')
  main.command({type: 'sign-in.cancel'})
  await signInFinished(main.sent)

  expect(main.sent.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'canceled',
  })
})

it('fails connecting when the driver throws', async () => {
  const main = fakeMain()

  const driver: ProviderDriver = {
    ...createFakeDriver({delayMs: 0}),
    // oxlint-disable-next-line require-yield -- a driver that breaks before its first step
    async *signIn() {
      throw new Error('no vendor program')
    },
  }

  await runHost(main.port, () => driver)

  main.command({type: 'sign-in.start', request: signInRequest})
  await signInFinished(main.sent)

  expect(main.sent.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason: 'failed', message: 'no vendor program'},
  })
})

it('passes a driver’s session store requests to main and main’s answers back', async () => {
  const main = fakeMain()
  let loaded: Promise<unknown> = Promise.resolve()

  await runHost(main.port, store => {
    loaded = store.load({projectKey: 'p', sessionId: 's'})

    return createFakeDriver({delayMs: 0})
  })

  const [asked] = main.sent

  if (asked?.type !== 'SESSION_STORE') throw new Error('Nothing was asked')

  main.command({
    type: 'session-store.result',
    requestId: asked.requestId,
    outcome: {ok: true, value: [{type: 'user', uuid: 'a'}]},
  })

  await expect(loaded).resolves.toEqual([{type: 'user', uuid: 'a'}])
})

it('rejects a session store request main couldn’t answer', async () => {
  const main = fakeMain()
  let saved: Promise<unknown> = Promise.resolve()

  await runHost(main.port, store => {
    saved = store.saveFiles({projectKey: 'p', sessionId: 's'}, [])

    return createFakeDriver({delayMs: 0})
  })

  const [asked] = main.sent

  if (asked?.type !== 'SESSION_STORE') throw new Error('Nothing was asked')

  main.command({
    type: 'session-store.result',
    requestId: asked.requestId,
    outcome: {ok: false, message: 'The disk is full.'},
  })

  await expect(saved).rejects.toThrow('The disk is full.')
})

import type {HostPort} from './main'
import type {HostMessage, ProviderDriver} from '@uz/contract/host'
import type {Model} from '@uz/contract/providers'

import {createFakeDriver} from '#modules/fake-driver/main'
import {expect, it} from 'vitest'

import {runHost} from './main'

const request = {
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
  model: 'fake',
  systemPrompt: '',
  prompt: {text: 'Hi', messageId: crypto.randomUUID()},
  vendorProgram: {program: null, configDir: '/claude'},
  session: null,
  compaction: {auto: true, threshold: null},
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

async function unhandledDuring(run: () => Promise<void>) {
  const unhandled: unknown[] = []

  function note(cause: unknown) {
    unhandled.push(cause)
  }

  process.on('unhandledRejection', note)

  try {
    await run()
    // Node reports a rejection as unhandled only once the microtasks drain.
    await new Promise(resolve => {
      setTimeout(resolve, 0)
    })
  } finally {
    process.off('unhandledRejection', note)
  }

  return unhandled
}

async function finished(sent: HostMessage[]) {
  await expect.poll(() => sent.at(-1)?.type).toBe('RUN_FINISHED')
}

it('says it is ready with the driver’s smallest Model', async () => {
  const main = fakeMain()
  await runHost(main.port, () => createFakeDriver({delayMs: 0}))

  expect(main.sent).toEqual([{type: 'HOST_READY', smallestModel: 'fake-small'}])
})

it('says it is ready with no smallest Model when the driver can’t read one', async () => {
  const main = fakeMain()

  await runHost(main.port, () => ({
    ...createFakeDriver({delayMs: 0}),
    smallestModel: async () => {
      throw new Error('not signed in')
    },
  }))

  expect(main.sent).toEqual([{type: 'HOST_READY', smallestModel: null}])
})

const vendorProgram = {program: null, configDir: '/codex'}

const pro = {
  id: 'pro',
  name: 'Pro',
  isDefault: false,
  resolvesTo: null,
  needsAppUpdate: false,
}

function listing(outcomes: (() => Promise<Model[]>)[]) {
  const asked: unknown[] = []

  const driver: ProviderDriver = {
    ...createFakeDriver({delayMs: 0}),
    async listModels(input) {
      asked.push(input)
      const outcome = outcomes.shift()

      if (!outcome) throw new Error('No list was expected')

      return outcome()
    },
  }

  return {driver, asked}
}

it('lists the driver’s Models for main', async () => {
  const main = fakeMain()
  const {driver, asked} = listing([async () => [pro]])
  await runHost(main.port, () => driver)

  main.command({type: 'models.list', vendorProgram})
  await expect.poll(() => main.sent.at(-1)?.type).toBe('MODELS_CHANGED')

  expect(asked).toEqual([vendorProgram])
  expect(main.sent.at(-1)).toEqual({type: 'MODELS_CHANGED', models: [pro]})
})

it('tells main nothing when the driver fails to list its Models', async () => {
  const main = fakeMain()

  const {driver} = listing([
    async () => {
      throw new Error('codex would not start')
    },
    async () => [pro],
  ])

  await runHost(main.port, () => driver)

  const unhandled = await unhandledDuring(async () => {
    main.command({type: 'models.list', vendorProgram})
    main.command({type: 'models.list', vendorProgram})
    await expect.poll(() => main.sent.at(-1)?.type).toBe('MODELS_CHANGED')
  })

  expect(unhandled).toEqual([])

  // The lists settle in order, so a post for the failed one comes first.
  expect(
    main.sent.filter(message => message.type === 'MODELS_CHANGED')
  ).toEqual([{type: 'MODELS_CHANGED', models: [pro]}])
})

it('tells main each list the driver learns on its own', async () => {
  const main = fakeMain()
  const listeners: ((models: Model[]) => void)[] = []

  await runHost(main.port, () => ({
    ...createFakeDriver({delayMs: 0}),
    onModelsChanged: listener => listeners.push(listener),
  }))

  const [learned] = listeners
  learned?.([pro])
  learned?.([])

  expect(main.sent.slice(1)).toEqual([
    {type: 'MODELS_CHANGED', models: [pro]},
    {type: 'MODELS_CHANGED', models: []},
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

it('stops a Reply on main’s word', async () => {
  const main = fakeMain()
  await runHost(main.port, () => createFakeDriver({delayMs: 1}))

  main.command({
    type: 'reply.start',
    request: {
      ...request,
      prompt: {text: 'Please /hang', messageId: crypto.randomUUID()},
    },
  })
  await expect
    .poll(
      () => main.sent.filter(message => message.type === 'TEXT_DELTA').length
    )
    .toBeGreaterThan(3)

  main.command({type: 'reply.stop', replyId: request.replyId})
  await finished(main.sent)

  expect(main.sent.at(-1)).toMatchObject({status: 'stopped'})
})

it('drops a command that does not parse', async () => {
  const main = fakeMain()
  await runHost(main.port, () => createFakeDriver({delayMs: 0}))

  const next = {...request, replyId: '01a16096-00af-7d3b-8205-6b76ddc26ce0'}

  main.command({type: 'reply.start', request: {...request, extra: true}})
  main.command({type: 'reply.start', request: next})
  await finished(main.sent)

  // Had it run, the dropped command would have streamed first.
  expect(
    main.sent.filter(
      message => 'replyId' in message && message.replyId !== next.replyId
    )
  ).toEqual([])
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
  await expect.poll(() => sent.at(-1)).toMatchObject({step})
}

async function signInFinished(sent: HostMessage[]) {
  await expect.poll(() => sent.at(-1)?.type).toBe('SIGN_IN_FINISHED')
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

const cut = {
  type: 'session.cut',
  treeId: request.treeId,
  replyId: request.replyId,
  session: {
    type: 'cut',
    sessionId: 's',
    messageId: 'kept',
    keepThrough: 'kept',
    dropFrom: 'deleted',
  },
  vendorProgram: {program: null, configDir: '/codex'},
}

function cutting(outcomes: (() => Promise<boolean>)[]) {
  const asked: unknown[] = []

  const driver: ProviderDriver = {
    ...createFakeDriver({delayMs: 0}),
    async cutSession(input) {
      asked.push(input)
      const outcome = outcomes.shift()

      if (!outcome) throw new Error('No cut was expected')

      return outcome()
    },
  }

  return {driver, asked}
}

it('tells main once the driver has cut the session', async () => {
  const main = fakeMain()
  const {driver, asked} = cutting([async () => true])
  await runHost(main.port, () => driver)

  main.command(cut)
  await expect.poll(() => main.sent.at(-1)?.type).toBe('SESSION_CUT')

  expect(asked).toEqual([
    {session: cut.session, vendorProgram: cut.vendorProgram},
  ])
  expect(main.sent.at(-1)).toEqual({
    type: 'SESSION_CUT',
    treeId: cut.treeId,
    replyId: cut.replyId,
    dropFrom: 'deleted',
  })
})

it('tells main nothing when the driver leaves the cut for later or fails it', async () => {
  const main = fakeMain()
  const failed = '01a16096-00b0-7d3b-8205-6b76ddc26ce0'
  const made = '01a16096-00b1-7d3b-8205-6b76ddc26ce0'

  const {driver} = cutting([
    async () => false,
    async () => {
      throw new Error('codex would not start')
    },
    async () => true,
  ])

  await runHost(main.port, () => driver)

  const unhandled = await unhandledDuring(async () => {
    main.command(cut)
    main.command({...cut, replyId: failed})
    main.command({...cut, replyId: made})
    await expect.poll(() => main.sent.at(-1)?.type).toBe('SESSION_CUT')
  })

  expect(unhandled).toEqual([])

  // The cuts settle in order, so a post for either earlier one comes first.
  expect(main.sent.filter(message => message.type === 'SESSION_CUT')).toEqual([
    {
      type: 'SESSION_CUT',
      treeId: cut.treeId,
      replyId: made,
      dropFrom: 'deleted',
    },
  ])
})

const oneShot = {
  type: 'one-shot.run',
  requestId: 'title-1',
  request: {
    model: 'haiku',
    prompt: 'Name this conversation.',
    vendorProgram: {program: null, configDir: '/claude'},
  },
}

function oneShots(outcomes: ((signal: AbortSignal) => Promise<string>)[]) {
  const asked: unknown[] = []
  const signals: AbortSignal[] = []

  const driver: ProviderDriver = {
    ...createFakeDriver({delayMs: 0}),
    async runOneShot(input, signal) {
      asked.push(input)
      signals.push(signal)
      const outcome = outcomes.shift()

      if (!outcome) throw new Error('No one-shot was expected')

      return outcome(signal)
    },
  }

  return {driver, asked, signals}
}

async function oneShotFinished(sent: HostMessage[]) {
  await expect.poll(() => sent.at(-1)?.type).toBe('ONE_SHOT_FINISHED')
}

it('runs a one-shot and answers main with its text', async () => {
  const main = fakeMain()
  const {driver, asked} = oneShots([async () => 'Otters at dusk'])
  await runHost(main.port, () => driver)

  main.command(oneShot)
  await oneShotFinished(main.sent)

  expect(asked).toEqual([oneShot.request])
  expect(main.sent.at(-1)).toEqual({
    type: 'ONE_SHOT_FINISHED',
    requestId: 'title-1',
    outcome: {ok: true, text: 'Otters at dusk'},
  })
})

it('answers main with the message when a one-shot fails', async () => {
  const main = fakeMain()

  const {driver} = oneShots([
    async () => {
      throw new Error('You hit your limit.')
    },
  ])

  await runHost(main.port, () => driver)

  main.command(oneShot)
  await oneShotFinished(main.sent)

  expect(main.sent.at(-1)).toEqual({
    type: 'ONE_SHOT_FINISHED',
    requestId: 'title-1',
    outcome: {ok: false, message: 'You hit your limit.'},
  })
})

async function untilAborted(signal: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('Canceled.')))
  })
}

it('cancels only the one-shot main names', async () => {
  const main = fakeMain()
  const {driver, signals} = oneShots([untilAborted, untilAborted])
  await runHost(main.port, () => driver)

  main.command(oneShot)
  main.command({...oneShot, requestId: 'title-2'})
  main.command({type: 'one-shot.cancel', requestId: 'title-2'})
  await oneShotFinished(main.sent)

  expect(main.sent.at(-1)).toEqual({
    type: 'ONE_SHOT_FINISHED',
    requestId: 'title-2',
    outcome: {ok: false, message: 'Canceled.'},
  })
  expect(signals.map(signal => signal.aborted)).toEqual([false, true])
})

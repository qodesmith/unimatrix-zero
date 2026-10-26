import type {ContentEvent, Ending, ReplyRun, WriteReply} from './main'
import type {ReplyRequest} from '@uz/contract/host'

import {expect, it, vi} from 'vitest'

import {ProgramCrashed, createReplyRuns} from './main'

const ids = {
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
}

const request: ReplyRequest = {
  ...ids,
  model: 'default',
  systemPrompt: '',
  prompt: {text: 'Hello'},
  vendorProgram: {program: null, configDir: '/config'},
  session: null,
}

const delta: ContentEvent = {...ids, type: 'TEXT_DELTA', delta: 'Hi'}

const complete: Ending = {
  finished: {...ids, type: 'RUN_FINISHED', status: 'complete'},
  recorded: {
    ...ids,
    type: 'REPLY_RECORDED',
    model: 'default',
    session: {sessionId: 's1', messageId: 'm1'},
  },
}

function writing(body: (run: ReplyRun) => Promise<Ending>): WriteReply {
  return async function* write(_, run) {
    yield delta

    return body(run)
  }
}

async function failureOf(error: Error, limitLifts?: () => number) {
  const runs = createReplyRuns(
    writing(async () => {
      throw error
    }),
    {limitLifts}
  )

  const events = await Array.fromAsync(runs.startReply(request))

  expect(events.map(event => event.type)).toEqual([
    'RUN_STARTED',
    'TEXT_DELTA',
    'RUN_FINISHED',
  ])

  return events.at(-1)
}

async function cleanedUpWith(body: () => Promise<Ending>) {
  const cleanUp = vi.fn<(status: string) => void>()

  const runs = createReplyRuns(
    writing(async run => {
      run.afterward(cleanUp)

      return body()
    })
  )

  for await (const event of runs.startReply(request)) {
    if (event.type === 'RUN_FINISHED') break
  }

  return cleanUp.mock.calls
}

/** Starts the Reply and reads on past `RUN_STARTED`, to the end in `rest`. */
async function startedReply(runs: ReturnType<typeof createReplyRuns>) {
  const events = runs.startReply(request)[Symbol.asyncIterator]()
  await events.next()

  return {rest: Array.fromAsync({[Symbol.asyncIterator]: () => events})}
}

async function typesOf(runs: ReturnType<typeof createReplyRuns>) {
  const events = await Array.fromAsync(runs.startReply(request))

  return events.map(event => event.type)
}

it('starts the run, streams the content, then records and finishes the Reply', async () => {
  const runs = createReplyRuns(writing(async () => complete))

  expect(await typesOf(runs)).toEqual([
    'RUN_STARTED',
    'TEXT_DELTA',
    'REPLY_RECORDED',
    'RUN_FINISHED',
  ])
})

it('never records a failed Reply', async () => {
  const runs = createReplyRuns(
    writing(async () => ({
      ...complete,
      finished: {
        ...ids,
        type: 'RUN_FINISHED',
        status: 'failed',
        failure: {code: 'provider-error', message: 'Overloaded'},
      },
    }))
  )

  expect(await typesOf(runs)).toEqual([
    'RUN_STARTED',
    'TEXT_DELTA',
    'RUN_FINISHED',
  ])
})

it('fails a throw with its reason, a crashed program as a crash', async () => {
  expect(await failureOf(new ProgramCrashed('Gone'))).toMatchObject({
    status: 'failed',
    failure: {code: 'program-crashed', message: 'Gone'},
  })
  expect(await failureOf(new Error('ENOSPC: no space left'))).toMatchObject({
    failure: {code: 'disk-full'},
  })
  expect(
    await failureOf(new Error('Usage limit reached'), () => 1_800_000_000)
  ).toMatchObject({
    failure: {
      code: 'limit-reached',
      resetsAt: new Date(1_800_000_000 * 1000).toISOString(),
    },
  })
})

it('passes on a Stop asked before the vendor program could be stopped, once it can', async () => {
  const interrupt = vi.fn<() => Promise<void>>(async () => undefined)
  const {promise: canStop, resolve: letStop} = Promise.withResolvers<void>()

  const runs = createReplyRuns(
    writing(async run => {
      await canStop
      run.stoppable(interrupt)

      return complete
    })
  )

  const {rest} = await startedReply(runs)
  await runs.stop(ids.replyId)

  expect(interrupt).not.toHaveBeenCalled()

  letStop()
  await rest

  expect(interrupt).toHaveBeenCalledOnce()
})

it('interrupts at once while the vendor program can be stopped, and waits again once it can’t', async () => {
  const interrupt = vi.fn<() => Promise<void>>(async () => undefined)
  const later = vi.fn<() => Promise<void>>(async () => undefined)

  const steps = {
    stoppable: Promise.withResolvers<void>(),
    withdrawn: Promise.withResolvers<void>(),
    again: Promise.withResolvers<void>(),
  }

  const runs = createReplyRuns(
    writing(async run => {
      const unstoppable = run.stoppable(interrupt)
      steps.stoppable.resolve()
      await steps.withdrawn.promise
      unstoppable()
      await steps.again.promise
      run.stoppable(later)

      return complete
    })
  )

  const {rest} = await startedReply(runs)
  await steps.stoppable.promise
  await runs.stop(ids.replyId)

  expect(interrupt).toHaveBeenCalledOnce()

  steps.withdrawn.resolve()
  await Promise.resolve()
  await runs.stop(ids.replyId)

  expect(interrupt).toHaveBeenCalledOnce()
  expect(later).not.toHaveBeenCalled()

  steps.again.resolve()
  await rest

  expect(later).toHaveBeenCalledOnce()
})

it('stops nothing for a Reply it isn’t writing', async () => {
  const runs = createReplyRuns(writing(async () => complete))

  await expect(runs.stop(ids.replyId)).resolves.toBeUndefined()
})

it('cleans up with how the Reply finished, before it is sent on, a throw included', async () => {
  expect(await cleanedUpWith(async () => complete)).toEqual([['complete']])
  expect(
    await cleanedUpWith(async () => {
      throw new Error('ENOSPC: no space left')
    })
  ).toEqual([['failed']])
})

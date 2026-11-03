import type {DownloadProgress} from '#modules/vendor-program/main'
import type {SignInUpdate} from '@uz/contract/providers'

import {expect, it} from 'vitest'

import {createSignIn, getReady} from './main'

const request = {program: null, configDir: '/data/providers/claude'}

async function* downloadUntilAborted(
  signal: AbortSignal
): AsyncGenerator<DownloadProgress> {
  yield {receivedBytes: 0, totalBytes: 1000}

  if (!signal.aborted) {
    await new Promise(resolve => {
      signal.addEventListener('abort', resolve)
    })
  }

  signal.throwIfAborted()
}

it('cancels the download', async () => {
  const signIn = createSignIn<object>(async function* (attempt) {
    const notReady = yield* getReady(
      attempt,
      downloadUntilAborted(attempt.signal)
    )

    if (notReady) yield notReady
  })

  const updates: SignInUpdate[] = []

  for await (const update of signIn.signIn(request)) {
    updates.push(update)

    if (update.type === 'SIGN_IN_STEP' && update.progress) signIn.cancelSignIn()
  }

  expect(updates).toEqual([
    {type: 'SIGN_IN_STEP', step: 'get-ready'},
    {
      type: 'SIGN_IN_STEP',
      step: 'get-ready',
      progress: {receivedBytes: 0, totalBytes: 1000},
    },
    {type: 'SIGN_IN_FINISHED', outcome: 'canceled'},
  ])
})

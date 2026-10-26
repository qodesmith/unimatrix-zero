import type {ProviderDriver} from '@uz/contract/host'
import type {SignInUpdate} from '@uz/contract/providers'

import {expect, it} from 'vitest'

import {createFakeDriver} from './main'
import {
  FAKE_ACCOUNT,
  FAKE_CODE,
  FAKE_FREE_CODE,
  FAKE_SIGN_IN_URL,
} from './sign-in'

const request = {program: null, configDir: '/nowhere'}

async function connect(
  driver: ProviderDriver,
  react: (update: SignInUpdate) => void = () => undefined
) {
  const updates: SignInUpdate[] = []

  for await (const update of driver.signIn(request)) {
    updates.push(update)
    react(update)
  }

  return updates
}

function steps(updates: SignInUpdate[]) {
  return updates.flatMap(update =>
    update.type === 'SIGN_IN_STEP' ? [update.step] : []
  )
}

it('downloads, then connects once the sign-in page answers', async () => {
  const driver = createFakeDriver({delayMs: 0, signInAnswerMs: 0})

  const updates = await connect(driver)

  expect(new Set(steps(updates))).toEqual(
    new Set(['get-ready', 'sign-in-page', 'check-plan'])
  )
  expect(updates.find(update => update.type === 'SIGN_IN_STEP')).toEqual({
    type: 'SIGN_IN_STEP',
    step: 'get-ready',
    progress: {receivedBytes: 0, totalBytes: 100_000_000},
  })
  expect(updates.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'connected',
    account: FAKE_ACCOUNT,
  })
})

it('takes the code from the page opened again, flagging a wrong one', async () => {
  const driver = createFakeDriver({delayMs: 0, signInAnswerMs: null})
  let attempts = 0

  const updates = await connect(driver, update => {
    if (update.type !== 'SIGN_IN_STEP') return

    if (update.step === 'sign-in-page') driver.signInPageOpened()

    if (update.step === 'paste-code') {
      attempts += 1
      driver.submitSignInCode(attempts === 1 ? 'typo' : FAKE_CODE)
    }
  })

  const pasting = updates.filter(
    update => update.type === 'SIGN_IN_STEP' && update.step === 'paste-code'
  )

  expect(pasting).toEqual([
    {type: 'SIGN_IN_STEP', step: 'paste-code', url: FAKE_SIGN_IN_URL},
    {
      type: 'SIGN_IN_STEP',
      step: 'paste-code',
      url: FAKE_SIGN_IN_URL,
      wrongCode: true,
    },
  ])
  expect(updates.at(-1)).toMatchObject({outcome: 'connected'})
})

it('refuses an account on a free plan', async () => {
  const driver = createFakeDriver({delayMs: 0, signInAnswerMs: null})

  const updates = await connect(driver, update => {
    if (update.type === 'SIGN_IN_STEP' && update.step === 'sign-in-page') {
      driver.submitSignInCode(FAKE_FREE_CODE)
    }
  })

  expect(updates.at(-1)).toMatchObject({
    type: 'SIGN_IN_FINISHED',
    outcome: 'failed',
    failure: {reason: 'plan-refused'},
  })
})

it('cancels during the download', async () => {
  const driver = createFakeDriver({delayMs: 0, signInAnswerMs: null})

  const updates = await connect(driver, update => {
    if (update.type === 'SIGN_IN_STEP' && update.step === 'get-ready') {
      driver.cancelSignIn()
    }
  })

  expect(steps(updates)).toEqual(['get-ready'])
  expect(updates.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'canceled',
  })
})

it('cancels while waiting on the sign-in page', async () => {
  const driver = createFakeDriver({delayMs: 0, signInAnswerMs: null})

  const updates = await connect(driver, update => {
    if (update.type === 'SIGN_IN_STEP' && update.step === 'sign-in-page') {
      driver.cancelSignIn()
    }
  })

  expect(updates.at(-1)).toEqual({
    type: 'SIGN_IN_FINISHED',
    outcome: 'canceled',
  })
})

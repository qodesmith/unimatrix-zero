import type {AppEvent} from '@uz/contract/events'

import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {expect, it} from 'vitest'

import {NOT_LOADED, applyConnectionEvent, cardOf} from './cards'

const url = 'https://claude.com/cai/oauth/authorize?code=true&state=s'

const account = {email: 'sam@example.com', plan: 'Max'}

function fold(events: AppEvent[]) {
  return events.reduce(applyConnectionEvent, NOT_LOADED)
}

const snapshot: AppEvent = {
  type: 'SNAPSHOT',
  app: {version: '1.0.0'},
  replies: [],
  providers: [
    {provider: 'claude', status: 'not-connected', account: null},
    {provider: 'chatgpt', status: 'not-connected', account: null},
  ],
  models: {claude: [], chatgpt: []},
  lastModel: null,
  signIn: null,
  settings: DEFAULT_SETTINGS,
  layout: DEFAULT_LAYOUT,
}

it('shows every card ready to connect once main has answered', () => {
  const state = fold([snapshot])

  expect(state.loaded).toBe(true)
  expect(cardOf(state, 'claude')).toEqual({kind: 'idle'})
})

it('follows the steps of connecting, then shows the account', () => {
  const step = {
    type: 'SIGN_IN_STEP',
    provider: 'claude',
    step: 'sign-in-page',
    url,
  } as const

  const connecting = fold([snapshot, step])

  expect(cardOf(connecting, 'claude')).toEqual({
    kind: 'connecting',
    step,
    pasting: false,
  })
  expect(cardOf(connecting, 'chatgpt')).toEqual({kind: 'idle'})

  const connected = fold([
    snapshot,
    step,
    {
      type: 'SIGN_IN_FINISHED',
      provider: 'claude',
      outcome: 'connected',
      account,
    },
    {type: 'PROVIDER_STATUS', provider: 'claude', status: 'ready', account},
  ])

  expect(cardOf(connected, 'claude')).toEqual({kind: 'connected', account})
})

it('keeps the paste step listed once a page with a code was opened', () => {
  const state = fold([
    snapshot,
    {type: 'SIGN_IN_STEP', provider: 'claude', step: 'paste-code', url},
    {type: 'SIGN_IN_STEP', provider: 'claude', step: 'check-plan'},
  ])

  expect(cardOf(state, 'claude')).toMatchObject({
    kind: 'connecting',
    pasting: true,
  })
})

it('shows a failure until connecting starts again', () => {
  const failure = {reason: 'plan-refused', message: 'No plan.'} as const

  const failed = fold([
    snapshot,
    {type: 'SIGN_IN_STEP', provider: 'claude', step: 'check-plan'},
    {type: 'SIGN_IN_FINISHED', provider: 'claude', outcome: 'failed', failure},
  ])

  expect(cardOf(failed, 'claude')).toEqual({kind: 'failed', failure})
  expect(
    cardOf(
      applyConnectionEvent(failed, {
        type: 'SIGN_IN_STEP',
        provider: 'claude',
        step: 'get-ready',
      }),
      'claude'
    )
  ).toMatchObject({kind: 'connecting'})
})

it('goes back to Connect when connecting is canceled', () => {
  const state = fold([
    snapshot,
    {type: 'SIGN_IN_STEP', provider: 'claude', step: 'get-ready'},
    {type: 'SIGN_IN_FINISHED', provider: 'claude', outcome: 'canceled'},
  ])

  expect(cardOf(state, 'claude')).toEqual({kind: 'idle'})
})

it('picks up a connect in progress from the SNAPSHOT', () => {
  const step = {
    type: 'SIGN_IN_STEP',
    provider: 'claude',
    step: 'paste-code',
    url,
  } as const

  const state = fold([{...snapshot, signIn: step}])

  expect(cardOf(state, 'claude')).toEqual({
    kind: 'connecting',
    step,
    pasting: true,
  })
})

const opus = {
  id: 'opus',
  name: 'Opus',
  isDefault: true,
  resolvesTo: null,
  needsAppUpdate: false,
}

it("keeps each Provider's Models from the SNAPSHOT, then from each refresh", () => {
  const sonnet = {...opus, id: 'sonnet', name: 'Sonnet', isDefault: false}
  const loaded = fold([{...snapshot, models: {claude: [opus], chatgpt: []}}])

  expect(loaded.models.claude).toEqual([opus])

  const refreshed = applyConnectionEvent(loaded, {
    type: 'MODELS_CHANGED',
    provider: 'claude',
    models: [opus, sonnet],
  })

  expect(refreshed.models).toEqual({claude: [opus, sonnet], chatgpt: []})
})

it('follows the last-used Model from the SNAPSHOT, then from each send', () => {
  const first = {provider: 'claude', model: 'opus'} as const
  const loaded = fold([{...snapshot, lastModel: first}])

  expect(loaded.lastModel).toEqual(first)

  const next = {provider: 'chatgpt', model: 'gpt-5'} as const

  expect(
    applyConnectionEvent(loaded, {type: 'LAST_MODEL_CHANGED', model: next})
      .lastModel
  ).toEqual(next)
})

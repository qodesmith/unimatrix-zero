import type {Model, ProviderStatus} from '@uz/contract/providers'

import {DEFAULT_MODEL_ID} from '@uz/contract/providers'
import {expect, it} from 'vitest'

import {pickModel} from './pick-model'

const account = {email: 'sam@example.com', plan: 'Max'}

function model(id: string, fields: Partial<Model> = {}): Model {
  return {
    id,
    name: id.toUpperCase(),
    isDefault: false,
    resolvesTo: null,
    needsAppUpdate: false,
    ...fields,
  }
}

const claudeModels = [
  model('haiku'),
  model('opus', {isDefault: true, resolvesTo: 'opus-4-7'}),
]

const chatgptModels = [model('gpt-5', {isDefault: true}), model('gpt-5-mini')]

const models = {claude: claudeModels, chatgpt: chatgptModels}

const connected: ProviderStatus[] = [
  {provider: 'claude', status: 'ready', account},
  {provider: 'chatgpt', status: 'ready', account},
]

function only(
  provider: ProviderStatus['provider'],
  status: ProviderStatus['status'],
  withAccount = true
): ProviderStatus[] {
  return connected.map(current =>
    current.provider === provider
      ? {provider, status, account: withAccount ? account : null}
      : current
  )
}

it('starts from the first connected Provider’s default when nothing is wanted', () => {
  const pick = pickModel({
    wanted: null,
    lockedTo: null,
    statuses: only('claude', 'not-connected', false),
    models,
  })

  expect(pick.selected).toEqual({
    provider: 'chatgpt',
    model: 'gpt-5',
    name: 'GPT-5',
  })
  expect(pick.notice).toBeNull()
  expect(pick.heldBecause).toBeNull()
})

it('passes over a signed-out Provider when nothing is wanted', () => {
  const pick = pickModel({
    wanted: null,
    lockedTo: null,
    statuses: only('claude', 'signed-out'),
    models,
  })

  expect(pick.selected).toEqual({
    provider: 'chatgpt',
    model: 'gpt-5',
    name: 'GPT-5',
  })
})

function opus() {
  return {provider: 'claude', model: 'opus', name: 'OPUS'}
}

it('keeps the wanted Model while its Provider lists it', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'haiku'},
    lockedTo: 'claude',
    statuses: connected,
    models,
  })

  expect(pick.selected).toEqual({
    provider: 'claude',
    model: 'haiku',
    name: 'HAIKU',
  })
  expect(pick.notice).toBeNull()
  expect(pick.heldBecause).toBeNull()
})

it('knows a Reply’s Model by the id it resolved to', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'opus-4-7'},
    lockedTo: 'claude',
    statuses: connected,
    models,
  })

  expect(pick.selected).toEqual(opus())
  expect(pick.notice).toBeNull()
})

it('prefers a Model’s own id over another’s resolved id', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'haiku'},
    lockedTo: null,
    statuses: connected,
    models: {
      ...models,
      claude: [model('opus', {resolvesTo: 'haiku'}), model('haiku')],
    },
  })

  expect(pick.selected?.model).toBe('haiku')
})

it('names a Reply’s Model by its own entry over the default that resolves to it too', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'opus-4-7'},
    lockedTo: 'claude',
    statuses: connected,
    models: {
      ...models,
      claude: [
        model('default', {isDefault: true, resolvesTo: 'opus-4-7'}),
        model('opus', {resolvesTo: 'opus-4-7'}),
      ],
    },
  })

  expect(pick.selected?.model).toBe('opus')
})

it('falls back to the Provider’s default, saying so, when the wanted Model needs an app update', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'haiku'},
    lockedTo: 'claude',
    statuses: connected,
    models: {
      ...models,
      claude: [
        model('haiku', {needsAppUpdate: true}),
        model('opus', {isDefault: true}),
      ],
    },
  })

  expect(pick.selected).toEqual(opus())
  expect(pick.notice).toBe('HAIKU needs an app update · using OPUS')
  expect(pick.heldBecause).toBeNull()
})

it('falls back to the Provider’s default, saying so, when the wanted Model is no longer offered', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'sonnet-3'},
    lockedTo: 'claude',
    statuses: connected,
    models,
  })

  expect(pick.selected).toEqual(opus())
  expect(pick.notice).toBe('sonnet-3 is no longer offered · using OPUS')
  expect(pick.heldBecause).toBeNull()
})

it('takes the first usable Model as the default when the marked one needs an app update', () => {
  const pick = pickModel({
    wanted: null,
    lockedTo: null,
    statuses: connected,
    models: {
      ...models,
      claude: [
        model('opus', {isDefault: true, needsAppUpdate: true}),
        model('haiku'),
      ],
    },
  })

  expect(pick.selected?.model).toBe('haiku')
})

it('offers every connected Provider’s Models at the root, a gated one included', () => {
  const gated = model('gpt-6', {needsAppUpdate: true})

  const pick = pickModel({
    wanted: null,
    lockedTo: null,
    statuses: connected,
    models: {...models, chatgpt: [...chatgptModels, gated]},
  })

  expect(pick.groups).toEqual([
    {provider: 'claude', models: claudeModels},
    {provider: 'chatgpt', models: [...chatgptModels, gated]},
  ])
})

it('offers no Models of a Provider that isn’t connected', () => {
  const pick = pickModel({
    wanted: null,
    lockedTo: null,
    statuses: only('chatgpt', 'not-connected', false),
    models,
  })

  expect(pick.groups.map(group => group.provider)).toEqual(['claude'])
})

it('offers no group for a connected Provider that hasn’t listed any Models', () => {
  const pick = pickModel({
    wanted: null,
    lockedTo: null,
    statuses: connected,
    models: {...models, claude: []},
  })

  expect(pick.groups).toEqual([{provider: 'chatgpt', models: chatgptModels}])
})

it('offers only the locked Provider’s Models in a continuing Thread', () => {
  const pick = pickModel({
    wanted: {provider: 'chatgpt', model: 'gpt-5'},
    lockedTo: 'chatgpt',
    statuses: connected,
    models,
  })

  expect(pick.groups.map(group => group.provider)).toEqual(['chatgpt'])
})

it('keeps a signed-out Provider’s Model, offering to sign in again and holding Send', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'haiku'},
    lockedTo: 'claude',
    statuses: only('claude', 'signed-out'),
    models,
  })

  expect(pick.selected).toEqual({
    provider: 'claude',
    model: 'haiku',
    name: 'HAIKU',
  })
  expect(pick.notice).toBeNull()
  expect(pick.signInAgain).toBe('claude')
  expect(pick.heldBecause).toBe('Sign in to Claude again to send')
})

it('keeps a signed-out Provider’s Model by its id when the list doesn’t know it', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'opus-4-7'},
    lockedTo: 'claude',
    statuses: only('claude', 'signed-out'),
    models: {...models, claude: []},
  })

  expect(pick.selected).toEqual({
    provider: 'claude',
    model: 'opus-4-7',
    name: 'opus-4-7',
  })
})

it('starts a new Tree on another connected Provider, saying so, when the last-used one was removed', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'opus'},
    lockedTo: null,
    statuses: only('claude', 'not-connected', false),
    models,
  })

  expect(pick.selected).toEqual({
    provider: 'chatgpt',
    model: 'gpt-5',
    name: 'GPT-5',
  })
  expect(pick.notice).toBe('Claude isn’t connected · using GPT-5')
  expect(pick.heldBecause).toBeNull()
})

it('holds Send at the root, saying why, when no Provider is connected', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'opus'},
    lockedTo: null,
    statuses: [
      {provider: 'claude', status: 'not-connected', account: null},
      {provider: 'chatgpt', status: 'not-connected', account: null},
    ],
    models,
  })

  expect(pick.selected).toBeNull()
  expect(pick.notice).toBe('Claude isn’t connected')
  expect(pick.heldBecause).toBe('Connect a Provider to send')
})

it('selects nothing in a continuing Thread whose Provider was removed, and holds Send', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'opus'},
    lockedTo: 'claude',
    statuses: only('claude', 'not-connected', false),
    models,
  })

  expect(pick.selected).toBeNull()
  expect(pick.groups).toEqual([])
  expect(pick.heldBecause).toBe('Connect Claude to continue this Thread')
})

it('sends on the wanted Model as it is while its Provider hasn’t listed any', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'opus'},
    lockedTo: 'claude',
    statuses: connected,
    models: {...models, claude: []},
  })

  expect(pick.selected).toEqual({
    provider: 'claude',
    model: 'opus',
    name: 'opus',
  })
  expect(pick.notice).toBeNull()
  expect(pick.heldBecause).toBeNull()
})

it('holds Send, saying so, when every Model of the Provider needs an app update', () => {
  const pick = pickModel({
    wanted: {provider: 'claude', model: 'opus'},
    lockedTo: 'claude',
    statuses: connected,
    models: {...models, claude: [model('opus', {needsAppUpdate: true})]},
  })

  expect(pick.selected).toBeNull()
  expect(pick.notice).toBe('OPUS needs an app update')
  expect(pick.heldBecause).toBe(
    'Claude offers no Model this app version can use'
  )
})

it('leaves the choice to the first connected Provider while it hasn’t listed any Models', () => {
  const pick = pickModel({
    wanted: null,
    lockedTo: null,
    statuses: connected,
    models: {...models, claude: []},
  })

  expect(pick.selected).toEqual({
    provider: 'claude',
    model: DEFAULT_MODEL_ID,
    name: 'Default',
  })
  expect(pick.heldBecause).toBeNull()
})

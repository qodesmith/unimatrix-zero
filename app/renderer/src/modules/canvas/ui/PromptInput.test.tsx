import type {CanvasState} from '../canvas-context'
import type {Bridge} from '@uz/contract/bridge'
import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {
  Model,
  ModelChoice,
  ProviderId,
  ProviderStatus,
} from '@uz/contract/providers'
import type {Settings} from '@uz/contract/settings'
import type {Prompt, Reply} from '@uz/contract/turns'
import type {ReactNode} from 'react'

import {ConnectionsProvider} from '#modules/connections/main'
import {SettingsProvider} from '#modules/settings/main'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fromPartial} from '@total-typescript/shoehorn'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {expect, it} from 'vitest'
import {render} from 'vitest-browser-react'
import {page, userEvent} from 'vitest/browser'

import {CanvasContext} from '../canvas-context'
import {indexTurns} from '../tree'
import {PromptInput} from './PromptInput'

const treeId = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'
const createdAt = '2026-10-19T12:00:00.000Z'
const account = {email: 'sam@example.com', plan: 'Max'}

function model(id: string, name: string, fields: Partial<Model> = {}): Model {
  return {
    id,
    name,
    isDefault: false,
    resolvesTo: null,
    needsAppUpdate: false,
    ...fields,
  }
}

const MODELS: Record<ProviderId, Model[]> = {
  claude: [
    model('opus', 'Opus', {isDefault: true, resolvesTo: 'opus-4-7'}),
    model('haiku', 'Haiku'),
    model('opus-5', 'Opus 5', {needsAppUpdate: true}),
  ],
  chatgpt: [model('gpt-5', 'GPT-5', {isDefault: true})],
}

const READY: ProviderStatus[] = [
  {provider: 'claude', status: 'ready', account},
  {provider: 'chatgpt', status: 'ready', account},
]

function attachedReply(provider: ProviderId, modelId: string): Reply {
  return {
    id: crypto.randomUUID(),
    treeId,
    promptId: crypto.randomUUID(),
    provider,
    model: modelId,
    status: 'complete',
    content: [{type: 'text', text: 'An answer'}],
    contextSize: null,
    contextWindow: null,
    failure: null,
    createdAt,
  }
}

interface Setup {
  attachedTo?: Reply
  lastModel?: ModelChoice | null
  providers?: ProviderStatus[]
  models?: Record<ProviderId, Model[]>
  sendKey?: Settings['sendKey']
}

function fakeMain({
  lastModel = null,
  providers = READY,
  models = MODELS,
  sendKey = DEFAULT_SETTINGS.sendKey,
}: Setup) {
  const sent: Command[] = []
  const listeners: ((event: AppEvent) => void)[] = []

  const bridge: Bridge = {
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type !== 'prompt.send') return {ok: true, value: {}}

      const prompt: Prompt = {
        id: crypto.randomUUID(),
        treeId,
        parentReplyId: command.parentReplyId,
        text: command.text,
        createdAt,
      }

      return {
        ok: true,
        value: {
          prompt,
          reply: {
            ...attachedReply(command.model.provider, command.model.model),
            promptId: prompt.id,
            status: 'streaming',
            content: [],
          },
        },
      }
    }) as Bridge['send'],
    subscribe: (listener: (event: AppEvent) => void) => {
      listeners.push(listener)
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: [],
        providers,
        models,
        lastModel,
        signIn: null,
        settings: {...DEFAULT_SETTINGS, sendKey},
        layout: DEFAULT_LAYOUT,
      })

      return () => undefined
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  return {...bridge, sent, publish}
}

async function renderInput(setup: Setup = {}) {
  const main = fakeMain(setup)
  globalThis.window.uz = main
  const {attachedTo} = setup

  const canvas = fromPartial<CanvasState>({
    index: indexTurns({prompts: [], replies: attachedTo ? [attachedTo] : []}),
  })

  function Providers({children}: {children: ReactNode}) {
    return (
      <QueryClientProvider client={new QueryClient()}>
        <SettingsProvider>
          <ConnectionsProvider>
            <CanvasContext value={canvas}>{children}</CanvasContext>
          </ConnectionsProvider>
        </SettingsProvider>
      </QueryClientProvider>
    )
  }

  await render(
    <PromptInput treeId={treeId} parentReplyId={attachedTo?.id ?? null} />,
    {wrapper: Providers}
  )

  return main
}

function sentTexts(main: ReturnType<typeof fakeMain>) {
  return main.sent.flatMap(command =>
    command.type === 'prompt.send' ? [command.text] : []
  )
}

function sentModels(main: ReturnType<typeof fakeMain>) {
  return main.sent.flatMap(command =>
    command.type === 'prompt.send' ? [command.model] : []
  )
}

function picker() {
  return page.getByRole('combobox', {name: 'Model'})
}

async function expectPicked(providerName: string, modelName: string) {
  await expect
    .element(picker().getByRole('img', {name: providerName}))
    .toBeVisible()
  await expect
    .element(picker().getByText(modelName, {exact: true}))
    .toBeVisible()
}

async function send(main: ReturnType<typeof fakeMain>) {
  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => sentModels(main).length).toBe(1)
}

it('defaults to the exact Model the attached Reply recorded, and sends on it', async () => {
  const main = await renderInput({
    attachedTo: attachedReply('claude', 'opus-4-7'),
    lastModel: {provider: 'chatgpt', model: 'gpt-5'},
  })

  await expectPicked('Claude', 'Opus')

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'claude', model: 'opus-4-7'}])
})

it('starts a new Tree from the last-used Model', async () => {
  const main = await renderInput({
    lastModel: {provider: 'chatgpt', model: 'gpt-5'},
  })

  await expectPicked('ChatGPT', 'GPT-5')

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'chatgpt', model: 'gpt-5'}])
})

it('sends the Model picked in the Input', async () => {
  const main = await renderInput({
    attachedTo: attachedReply('claude', 'opus-4-7'),
  })

  await picker().click()
  await page.getByRole('option', {name: 'Haiku'}).click()
  await expectPicked('Claude', 'Haiku')

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'claude', model: 'haiku'}])
})

it('sends the Model the default resolved to when picked, still showing the default, and stays on it after the default moves', async () => {
  const main = await renderInput({
    attachedTo: attachedReply('claude', 'haiku'),
  })

  await picker().click()
  await page.getByRole('option', {name: 'Opus', exact: true}).click()
  await expectPicked('Claude', 'Opus')

  main.publish({
    type: 'MODELS_CHANGED',
    provider: 'claude',
    models: [
      model('opus', 'Opus', {isDefault: true, resolvesTo: 'opus-5-5'}),
      model('opus-4-7', 'Opus 4.7'),
    ],
  })
  await expectPicked('Claude', 'Opus 4.7')

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'claude', model: 'opus-4-7'}])
})

it('lists only the Thread’s own Provider in a continuing Thread', async () => {
  await renderInput({attachedTo: attachedReply('claude', 'opus-4-7')})

  await picker().click()
  await expect.element(page.getByRole('option', {name: 'Haiku'})).toBeVisible()
  expect(page.getByRole('option', {name: 'GPT-5'}).query()).toBeNull()
})

it('lists a Model the app is too old for, disabled as needing an app update', async () => {
  await renderInput()

  await picker().click()

  const gated = page.getByRole('option', {name: /Opus 5/})

  await expect.element(gated).toHaveAttribute('aria-disabled', 'true')
  await expect.element(gated.getByText('Needs an app update')).toBeVisible()
})

it('holds Send, saying which Model is gone, until another is picked', async () => {
  const main = await renderInput({
    attachedTo: attachedReply('claude', 'sonnet-3'),
  })

  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await expect
    .element(page.getByText('sonnet-3 is no longer offered'))
    .toBeVisible()
  await expect.element(page.getByRole('button', {name: 'Send'})).toBeDisabled()

  await picker().click()
  await page.getByRole('option', {name: 'Haiku'}).click()

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'claude', model: 'haiku'}])
})

it('holds Send, saying so, until its Provider has listed its Models', async () => {
  const main = await renderInput({
    models: {...MODELS, claude: []},
    attachedTo: attachedReply('claude', 'opus-4-7'),
  })

  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await expect.element(page.getByText('Loading Models…')).toBeVisible()
  await expect.element(page.getByRole('button', {name: 'Send'})).toBeDisabled()

  main.publish({
    type: 'MODELS_CHANGED',
    provider: 'claude',
    models: MODELS.claude,
  })

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'claude', model: 'opus-4-7'}])
})

it('offers to sign in again beside a signed-out Provider’s Model, holding Send', async () => {
  const main = await renderInput({
    attachedTo: attachedReply('claude', 'haiku'),
    providers: [
      {provider: 'claude', status: 'signed-out', account},
      {provider: 'chatgpt', status: 'ready', account},
    ],
  })

  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await expect.element(page.getByRole('button', {name: 'Send'})).toBeDisabled()
  await expectPicked('Claude', 'Haiku')
  await expect
    .element(page.getByText('Sign in to Claude again to send'))
    .toBeVisible()

  await page.getByRole('button', {name: 'Sign in again'}).click()
  expect(main.sent).toContainEqual({
    type: 'provider.connect',
    provider: 'claude',
  })
})

it('breaks a line on Shift+Enter and sends on Enter, by default', async () => {
  const main = await renderInput()
  const input = page.getByRole('textbox', {name: 'Prompt'})

  await input.fill('Hello?')
  await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
  await expect.element(input).toHaveValue('Hello?\n')
  await userEvent.keyboard('There{Enter}')

  await expect.poll(() => sentTexts(main)).toEqual(['Hello?\nThere'])
})

it.each(['Meta', 'Control'])(
  'breaks a line on Enter and sends on %s+Enter when the send key Setting says so',
  async held => {
    const main = await renderInput({sendKey: 'mod-enter'})
    const input = page.getByRole('textbox', {name: 'Prompt'})

    await input.fill('Hello?')
    await userEvent.keyboard('{Enter}')
    await expect.element(input).toHaveValue('Hello?\n')
    await userEvent.keyboard(`There{${held}>}{Enter}{/${held}}`)

    await expect.poll(() => sentTexts(main)).toEqual(['Hello?\nThere'])
  }
)

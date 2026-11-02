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
}

function fakeMain({lastModel = null, providers = READY}: Setup) {
  const sent: Command[] = []

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
      listener({
        type: 'SNAPSHOT',
        app: {version: '0.0.0'},
        replies: [],
        providers,
        models: MODELS,
        lastModel,
        signIn: null,
        settings: DEFAULT_SETTINGS,
        layout: DEFAULT_LAYOUT,
      })

      return () => undefined
    },
    registerDroppedFile: async () => ({ok: true, id: crypto.randomUUID()}),
  }

  return {...bridge, sent}
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

it('defaults to the Model of the Reply it is attached to, and sends with it', async () => {
  const main = await renderInput({
    attachedTo: attachedReply('claude', 'opus-4-7'),
    lastModel: {provider: 'chatgpt', model: 'gpt-5'},
  })

  await expectPicked('Claude', 'Opus')

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'claude', model: 'opus'}])
})

it('starts a new Tree from the last-used Model', async () => {
  const main = await renderInput({
    lastModel: {provider: 'chatgpt', model: 'gpt-5'},
  })

  await expectPicked('ChatGPT', 'GPT-5')

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'chatgpt', model: 'gpt-5'}])
})

it('sends the Model picked in the Input, closing the picker on the pick', async () => {
  const main = await renderInput({
    attachedTo: attachedReply('claude', 'opus'),
  })

  await picker().click()
  await page.getByRole('option', {name: 'Haiku'}).click()
  await expectPicked('Claude', 'Haiku')
  await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'claude', model: 'haiku'}])
})

it('lists only the Thread’s own Provider in a continuing Thread', async () => {
  await renderInput({attachedTo: attachedReply('claude', 'opus')})

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
  await expect.element(page.getByRole('option', {name: 'GPT-5'})).toBeVisible()
})

it('falls back to the Provider’s default, visibly, when the Reply’s Model is no longer offered', async () => {
  const main = await renderInput({
    attachedTo: attachedReply('claude', 'sonnet-3'),
  })

  await expect
    .element(page.getByText('sonnet-3 is no longer offered · using Opus'))
    .toBeVisible()

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'claude', model: 'opus'}])
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

it('holds Send in a continuing Thread whose Provider was removed', async () => {
  await renderInput({
    attachedTo: attachedReply('claude', 'opus'),
    providers: [
      {provider: 'claude', status: 'not-connected', account: null},
      {provider: 'chatgpt', status: 'ready', account},
    ],
  })

  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await expect.element(page.getByRole('button', {name: 'Send'})).toBeDisabled()
  await expect
    .element(page.getByText('Connect Claude to continue this Thread'))
    .toBeVisible()
})

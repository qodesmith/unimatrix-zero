import type {CanvasState} from '../canvas-context'
import type {Attachment} from '@uz/contract/attachments'
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
import {
  ATTACHMENTS_PER_PROMPT,
  ATTACHMENT_SIZE_LIMIT,
  AttachmentMediaTypeSchema,
  attachmentUrl,
} from '@uz/contract/attachments'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {expect, it, vi} from 'vitest'
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
    compacted: false,
    rebuilt: false,
    createdAt,
  }
}

interface Setup {
  attachedTo?: Reply
  /** The Prompts above the attached Reply. */
  prompts?: Prompt[]
  lastModel?: ModelChoice | null
  providers?: ProviderStatus[]
  models?: Record<ProviderId, Model[]>
  sendKey?: Settings['sendKey']
  reReadNote?: Settings['reReadNote']
}

interface Sends {
  waiting: (() => void)[]
  hold: boolean
  refusal: string | null
}

interface Files {
  registered: File[]
  /** What main kept, in the order it answered. */
  added: Attachment[]
  /** Each File by the id `registerDroppedFile` gave it. */
  byId: Map<string, File>
  /** True for a File with no path, such as a pasted screenshot. */
  noPath: boolean
  waiting: (() => void)[]
  hold: boolean
  refusal: string | null
}

function kept(name: string, mediaType: string, size: number): Attachment {
  return {
    id: crypto.randomUUID(),
    name,
    mediaType: AttachmentMediaTypeSchema.parse(mediaType),
    size,
  }
}

function fakeMain({
  lastModel = null,
  providers = READY,
  models = MODELS,
  sendKey = DEFAULT_SETTINGS.sendKey,
  reReadNote = DEFAULT_SETTINGS.reReadNote,
}: Setup) {
  const sent: Command[] = []
  const listeners: ((event: AppEvent) => void)[] = []
  const sends: Sends = {waiting: [], hold: false, refusal: null}
  const attachments = new Map<string, Attachment>()

  const files: Files = {
    registered: [],
    added: [],
    byId: new Map(),
    noPath: false,
    waiting: [],
    hold: false,
    refusal: null,
  }

  async function add({file}: Extract<Command, {type: 'attachment.add'}>) {
    if (files.hold) {
      const {promise, resolve} = Promise.withResolvers<undefined>()
      files.waiting.push(() => resolve(undefined))
      await promise
    }

    if (files.refusal !== null) {
      return {
        ok: false,
        error: {code: 'handler-failed', message: files.refusal},
      }
    }

    const from = file.type === 'dropped' ? files.byId.get(file.fileId) : null

    const attachment = from
      ? kept(from.name, from.type, from.size)
      : kept(file.type === 'pasted' ? file.name : 'gone', 'image/png', 3)

    attachments.set(attachment.id, attachment)
    files.added.push(attachment)

    return {ok: true, value: {attachment}}
  }

  const bridge: Bridge = {
    send: (async (command: Command) => {
      sent.push(command)

      if (command.type === 'attachment.add') return add(command)

      if (command.type !== 'prompt.send') return {ok: true, value: {}}

      if (sends.hold) {
        const {promise, resolve} = Promise.withResolvers<undefined>()
        sends.waiting.push(() => resolve(undefined))
        await promise
      }

      if (sends.refusal !== null) {
        return {
          ok: false,
          error: {code: 'handler-failed', message: sends.refusal},
        }
      }

      const prompt: Prompt = {
        id: crypto.randomUUID(),
        treeId,
        parentReplyId: command.parentReplyId,
        text: command.text,
        attachments: (command.attachmentIds ?? []).flatMap(
          id => attachments.get(id) ?? []
        ),
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
          removed: {promptIds: [], replyIds: []},
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
        settings: {...DEFAULT_SETTINGS, sendKey, reReadNote},
        layout: DEFAULT_LAYOUT,
      })

      return () => undefined
    },
    registerDroppedFile: async (file: File) => {
      files.registered.push(file)

      if (files.noPath) {
        return {
          ok: false,
          error: {code: 'no-path', message: 'The file has no path.'},
        }
      }

      const id = crypto.randomUUID()
      files.byId.set(id, file)

      return {ok: true, id}
    },
  }

  function publish(event: AppEvent) {
    for (const listener of listeners) listener(event)
  }

  return {...bridge, sent, sends, files, publish}
}

async function renderInput(setup: Setup = {}) {
  const main = fakeMain(setup)
  globalThis.window.uz = main
  const {attachedTo, prompts = []} = setup

  const canvas = fromPartial<CanvasState>({
    index: indexTurns({prompts, replies: attachedTo ? [attachedTo] : []}),
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

it('lists every connected Provider in a continuing Thread, and sends the Thread on to the other one picked', async () => {
  const main = await renderInput({
    attachedTo: attachedReply('claude', 'opus-4-7'),
  })

  await picker().click()
  await expect.element(page.getByRole('option', {name: 'Haiku'})).toBeVisible()
  await page.getByRole('option', {name: 'GPT-5'}).click()
  await expectPicked('ChatGPT', 'GPT-5')

  await send(main)
  expect(sentModels(main)).toEqual([{provider: 'chatgpt', model: 'gpt-5'}])
})

function sized(contextSize: number) {
  return {...attachedReply('claude', 'opus-4-7'), contextSize}
}

const SWITCH_NOTE =
  'Switching to ChatGPT will re-read ~63k tokens of this conversation (uses more of your limit).'

it('says above the Input how much of a long Thread another Provider will re-read, once it’s picked', async () => {
  await renderInput({attachedTo: sized(49_000)})

  expect(page.getByRole('note').query()).toBeNull()

  await picker().click()
  await page.getByRole('option', {name: 'GPT-5'}).click()

  await expect.element(page.getByRole('note')).toHaveTextContent(SWITCH_NOTE)
})

it('says nothing when the Thread is short', async () => {
  await renderInput({attachedTo: sized(1000)})
  await picker().click()
  await page.getByRole('option', {name: 'GPT-5'}).click()
  await expectPicked('ChatGPT', 'GPT-5')

  expect(page.getByRole('note').query()).toBeNull()
})

it('says nothing when the Setting hides the note', async () => {
  await renderInput({attachedTo: sized(49_000), reReadNote: false})
  await picker().click()
  await page.getByRole('option', {name: 'GPT-5'}).click()
  await expectPicked('ChatGPT', 'GPT-5')

  expect(page.getByRole('note').query()).toBeNull()
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

it('shows main’s refusal with the Prompt still in the Input, and drops it while the next send is on its way', async () => {
  const main = await renderInput()
  const input = page.getByRole('textbox', {name: 'Prompt'})

  main.sends.refusal = 'The disk is full.'
  await send(main)
  await expect.element(page.getByText('The disk is full.')).toBeVisible()
  await expect.element(input).toHaveValue('Hello?')

  main.sends.refusal = null
  main.sends.hold = true
  await userEvent.keyboard('{Enter}')
  await expect.poll(() => main.sends.waiting.length).toBe(1)
  await expect
    .element(page.getByText('The disk is full.'))
    .not.toBeInTheDocument()

  main.sends.waiting[0]?.()
  await expect.element(input).toHaveValue('')
})

it('sends a Prompt once however often it is submitted while main takes it', async () => {
  const main = await renderInput()

  main.sends.hold = true
  await send(main)
  await expect.element(page.getByRole('button', {name: 'Send'})).toBeDisabled()
  await userEvent.keyboard('{Enter}{Enter}')

  main.sends.hold = false
  main.sends.waiting[0]?.()
  await expect
    .element(page.getByRole('textbox', {name: 'Prompt'}))
    .toHaveValue('')
  expect(sentTexts(main)).toEqual(['Hello?'])
})

it('keeps what was typed, the files attached and the Model picked while main took the Prompt, dropping the files sent', async () => {
  const main = await renderInput()
  const input = page.getByRole('textbox', {name: 'Prompt'})

  await attach(textFile('sent.txt', 'Sent'))
  main.sends.hold = true
  await send(main)
  await userEvent.keyboard('And another thing')
  await attach(textFile('later.txt', 'Later'))
  await picker().click()
  await page.getByRole('option', {name: 'Haiku'}).click()

  main.sends.waiting[0]?.()
  await expect.element(input).toHaveValue('And another thing')
  await expect.element(attachedFile('sent.txt')).not.toBeInTheDocument()
  await expect.element(attachedFile('later.txt')).toBeVisible()
  await expectPicked('Claude', 'Haiku')
})

function addedFiles(main: ReturnType<typeof fakeMain>) {
  return main.sent.flatMap(command =>
    command.type === 'attachment.add' ? [command.file] : []
  )
}

function textFile(name: string, text: string) {
  return new File([text], name, {type: 'text/plain'})
}

function attachedFile(name: string) {
  return page.getByRole('group', {name})
}

it('opens the file chooser from the attach button, and attaches each file picked by the id main gave its path', async () => {
  const main = await renderInput()
  const chooser = page.getByLabelText('Files to attach')

  const opened = vi
    .spyOn(chooser.element() as HTMLInputElement, 'click')
    .mockImplementation(() => undefined)

  await page.getByRole('button', {name: 'Attach files'}).click()
  expect(opened).toHaveBeenCalledOnce()

  await chooser.upload([
    textFile('notes.txt', 'Some notes'),
    textFile('todo.txt', 'Buy milk'),
  ])

  await expectAdded('notes.txt')
  await expectAdded('todo.txt')
  expect(main.files.registered.map(({name}) => name)).toEqual([
    'notes.txt',
    'todo.txt',
  ])
  expect(addedFiles(main)).toEqual(
    [...main.files.byId.keys()].map(fileId => ({type: 'dropped', fileId}))
  )
})

async function startAttaching(...files: File[]) {
  await page.getByLabelText('Files to attach').upload(files)
}

async function expectAdded(name: string) {
  await expect.element(attachedFile(name)).toBeVisible()
  await expect
    .element(attachedFile(name).getByText('Adding…'))
    .not.toBeInTheDocument()
}

async function attach(...files: File[]) {
  await startAttaching(...files)

  for (const {name} of files) await expectAdded(name)
}

function dataOf(files: File[]) {
  const data = new DataTransfer()

  for (const file of files) data.items.add(file)

  return data
}

function paste(files: File[]) {
  const event = new ClipboardEvent('paste', {
    clipboardData: dataOf(files),
    bubbles: true,
    cancelable: true,
  })

  page.getByRole('textbox', {name: 'Prompt'}).element().dispatchEvent(event)
}

it('attaches a pasted file by its bytes only when it has no path, and by the id main gave its path otherwise', async () => {
  const main = await renderInput()

  const screenshot = new File([new Uint8Array([1, 2, 3])], 'image.png', {
    type: 'image/png',
  })

  main.files.noPath = true
  paste([screenshot])
  await expectAdded('image.png')

  main.files.noPath = false
  paste([textFile('copied.txt', 'Copied')])
  await expectAdded('copied.txt')

  expect(main.files.registered.map(({name}) => name)).toEqual([
    'image.png',
    'copied.txt',
  ])
  expect(addedFiles(main)).toEqual([
    {type: 'pasted', name: 'image.png', bytes: new Uint8Array([1, 2, 3])},
    {type: 'dropped', fileId: [...main.files.byId.keys()][0]},
  ])
})

it('pastes plain text into the Prompt as text, attaching nothing', async () => {
  const main = await renderInput()
  const input = page.getByRole('textbox', {name: 'Prompt'})

  await input.fill('Copied words')
  await userEvent.keyboard('{ControlOrMeta>}a{/ControlOrMeta}')
  await userEvent.copy()
  await input.fill('')
  await userEvent.paste()

  await expect.element(input).toHaveValue('Copied words')
  expect(main.files.registered).toEqual([])
  expect(addedFiles(main)).toEqual([])
})

it('attaches files dropped onto the Input by the id main gave each path', async () => {
  const main = await renderInput()
  const data = dataOf([textFile('dropped.txt', 'Dropped')])
  const input = page.getByRole('textbox', {name: 'Prompt'}).element()

  const over = new DragEvent('dragover', {
    dataTransfer: data,
    bubbles: true,
    cancelable: true,
  })

  input.dispatchEvent(over)
  expect(over.defaultPrevented).toBe(true)
  input.dispatchEvent(
    new DragEvent('drop', {dataTransfer: data, bubbles: true, cancelable: true})
  )

  await expectAdded('dropped.txt')
  expect(main.files.registered.map(({name}) => name)).toEqual(['dropped.txt'])
  expect(addedFiles(main)).toEqual([
    {type: 'dropped', fileId: [...main.files.byId.keys()][0]},
  ])
})

it('shows a file as being added, holding Send, until main has kept it', async () => {
  const main = await renderInput()
  const sendButton = page.getByRole('button', {name: 'Send'})

  main.files.hold = true
  await page.getByRole('textbox', {name: 'Prompt'}).fill('Hello?')
  await startAttaching(textFile('notes.txt', 'Some notes'))

  await expect
    .element(attachedFile('notes.txt').getByText('Adding…'))
    .toBeVisible()
  await expect.element(sendButton).toBeDisabled()

  await expect.poll(() => main.files.waiting.length).toBe(1)
  main.files.waiting[0]?.()
  await expect
    .element(attachedFile('notes.txt').getByText('10 bytes'))
    .toBeVisible()
  await expect.element(sendButton).toBeEnabled()
})

it('shows main’s refusal on the file, which holds no send back and can be dismissed', async () => {
  const main = await renderInput()

  main.files.refusal = 'The disk is full.'
  await startAttaching(textFile('notes.txt', 'Some notes'))

  await expect
    .element(attachedFile('notes.txt').getByRole('alert'))
    .toHaveTextContent('The disk is full.')

  await send(main)

  await page.getByRole('button', {name: 'Dismiss notes.txt'}).click()
  await expect.element(attachedFile('notes.txt')).not.toBeInTheDocument()
})

it('refuses a file over the size limit without asking main', async () => {
  const main = await renderInput()

  await startAttaching(
    new File([new Uint8Array(ATTACHMENT_SIZE_LIMIT + 1)], 'huge.bin')
  )

  await expect
    .element(attachedFile('huge.bin').getByRole('alert'))
    .toHaveTextContent('Larger than 20 MB, the most one file can be')
  expect(main.files.registered).toEqual([])
  expect(addedFiles(main)).toEqual([])
})

function sentPrompts(main: ReturnType<typeof fakeMain>) {
  return main.sent.flatMap(command =>
    command.type === 'prompt.send' ? [command] : []
  )
}

it('sends the files in the order attached, with no text needed, and empties the Input', async () => {
  const main = await renderInput()
  const sendButton = page.getByRole('button', {name: 'Send'})

  await expect.element(sendButton).toBeDisabled()
  await attach(textFile('first.txt', 'One'), textFile('second.txt', 'Two'))
  await attach(textFile('third.txt', 'Three'))
  await sendButton.click()

  await expect.poll(() => sentPrompts(main).length).toBe(1)
  expect(sentPrompts(main)[0]).toMatchObject({
    text: '',
    attachmentIds: main.files.added.map(({id}) => id),
  })
  expect(main.files.added.map(({name}) => name)).toEqual([
    'first.txt',
    'second.txt',
    'third.txt',
  ])
  await expect.element(attachedFile('first.txt')).not.toBeInTheDocument()
  await expect.element(attachedFile('third.txt')).not.toBeInTheDocument()
})

it('holds Send, saying how many to remove, while the Input holds more files than a Prompt takes', async () => {
  await renderInput()
  const sendButton = page.getByRole('button', {name: 'Send'})

  const files = Array.from({length: ATTACHMENTS_PER_PROMPT + 2}, (_, at) =>
    textFile(`${at}.txt`, `File ${at}`)
  )

  await attach(...files)
  await expect.element(sendButton).toBeDisabled()
  await expect
    .element(page.getByText('A Prompt takes at most 20 files; remove 2.'))
    .toBeInTheDocument()

  await page.getByRole('button', {name: 'Remove 0.txt'}).click()
  await page.getByRole('button', {name: 'Remove 1.txt'}).click()
  await expect.element(sendButton).toBeEnabled()
})

it('removes a file before sending, and sends without it', async () => {
  const main = await renderInput()

  await attach(textFile('kept.txt', 'Kept'), textFile('dropped.txt', 'Gone'))
  await page.getByRole('button', {name: 'Remove dropped.txt'}).click()
  await expect.element(attachedFile('dropped.txt')).not.toBeInTheDocument()

  await send(main)
  expect(sentPrompts(main)[0]?.attachmentIds).toEqual([main.files.added[0]?.id])
})

it('shows an image as a thumbnail that opens large in a lightbox, and another file as a chip with its name and size', async () => {
  const main = await renderInput()

  await attach(
    new File([new Uint8Array(3)], 'shot.png', {type: 'image/png'}),
    new File([new Uint8Array(2048)], 'notes.pdf', {type: 'application/pdf'})
  )

  const [image] = main.files.added
  const thumbnail = attachedFile('shot.png')

  await expect
    .element(thumbnail.getByRole('img', {name: 'shot.png'}))
    .toHaveAttribute('src', attachmentUrl(image?.id ?? ''))
  await expect.element(thumbnail.getByText('3 bytes')).not.toBeInTheDocument()
  await expect
    .element(attachedFile('notes.pdf').getByText('2 KB'))
    .toBeVisible()
  expect(attachedFile('notes.pdf').getByRole('img').query()).toBeNull()

  await page.getByRole('button', {name: 'Open shot.png'}).click()
  await expect
    .element(
      page
        .getByRole('dialog', {name: 'shot.png'})
        .getByRole('img', {name: 'shot.png'})
    )
    .toHaveAttribute('src', attachmentUrl(image?.id ?? ''))
})

const PDF_NOTE = '1 PDF sent as text (layout and images not included)'

function pdf(name: string) {
  return new File(['%PDF'], name, {type: 'application/pdf'})
}

it('says a PDF goes as text once a Model whose Provider takes none as is is picked, beside the re-read note, never disabling the attach button', async () => {
  await renderInput({attachedTo: sized(49_000)})

  await attach(pdf('paper.pdf'))
  expect(page.getByRole('note').query()).toBeNull()

  await picker().click()
  await page.getByRole('option', {name: 'GPT-5'}).click()

  await expect
    .element(page.getByRole('note').filter({hasText: PDF_NOTE}))
    .toBeVisible()
  await expect
    .element(page.getByRole('note').filter({hasText: SWITCH_NOTE}))
    .toBeVisible()
  await expect
    .element(page.getByRole('button', {name: 'Attach files'}))
    .toBeEnabled()
})

it('counts the PDFs on the Thread above when it is handed over to such a Provider', async () => {
  const attachedTo = attachedReply('claude', 'opus-4-7')

  await renderInput({
    attachedTo,
    prompts: [
      {
        id: attachedTo.promptId,
        treeId,
        parentReplyId: null,
        text: 'Read this',
        attachments: [kept('paper.pdf', 'application/pdf', 4)],
        createdAt,
      },
    ],
  })

  await picker().click()
  await page.getByRole('option', {name: 'GPT-5'}).click()

  await expect.element(page.getByRole('note')).toHaveTextContent(PDF_NOTE)
})

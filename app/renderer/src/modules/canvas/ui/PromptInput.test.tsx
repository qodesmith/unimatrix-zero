import type {CanvasState} from '../canvas-context'
import type {Draft} from '../drafts'
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
  INLINE_IMAGE_PIXELS,
  INLINE_IMAGE_SIZE_LIMIT,
  INLINE_TEXT_SIZE_LIMIT,
  attachmentUrl,
} from '@uz/contract/attachments'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {PRESETS} from '@uz/contract/system-prompts'
import {useState} from 'react'
import {expect, it, vi} from 'vitest'
import {render} from 'vitest-browser-react'
import {page, userEvent} from 'vitest/browser'

import {CanvasContext} from '../canvas-context'
import {EMPTY_DRAFT} from '../drafts'
import {indexTurns} from '../tree'
import {PromptInput} from './PromptInput'

const treeId = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'
const createdAt = '2026-10-19T12:00:00.000Z'
const SYSTEM_PROMPT_ID = '019ab3c0-5e1f-7000-8000-000000000001'
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
    systemPromptId: SYSTEM_PROMPT_ID,
    files: [],
    createdAt,
  }
}

interface Setup {
  attachedTo?: Reply
  prompts?: Prompt[]
  lastModel?: ModelChoice | null
  providers?: ProviderStatus[]
  models?: Record<ProviderId, Model[]>
  sendKey?: Settings['sendKey']
  reReadNote?: Settings['reReadNote']
  attachments?: Attachment[]
  /** The Tree's System prompt now. */
  systemPromptId?: string
}

interface Sends {
  waiting: (() => void)[]
  hold: boolean
  refusal: string | null
}

interface Files {
  registered: File[]
  added: Attachment[]
  byId: Map<string, File>
  noPath: boolean
  /** By name, the path of each dropped File that main finds is a folder. */
  folders: Map<string, string>
  waiting: (() => void)[]
  hold: boolean
  refusal: string | null
}

function kept(
  name: string,
  mediaType: string,
  size: number,
  fields: Partial<Attachment> = {}
): Attachment {
  return {
    id: crypto.randomUUID(),
    name,
    mediaType:
      AttachmentMediaTypeSchema.safeParse(mediaType).data ??
      'application/octet-stream',
    size,
    shrunkSize: null,
    folderPath: null,
    missing: false,
    extraction: null,
    ...fields,
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
    folders: new Map(),
    waiting: [],
    hold: false,
    refusal: null,
  }

  function keep({file, shrunk}: Extract<Command, {type: 'attachment.add'}>) {
    const from = file.type === 'dropped' ? files.byId.get(file.fileId) : null
    const folderPath = from && files.folders.get(from.name)
    const shrunkSize = shrunk?.byteLength ?? null

    if (folderPath) return kept(from.name, 'inode/directory', 0, {folderPath})

    return from
      ? kept(from.name, from.type, from.size, {shrunkSize})
      : kept(file.type === 'pasted' ? file.name : 'gone', 'image/png', 3)
  }

  async function add(command: Extract<Command, {type: 'attachment.add'}>) {
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

    const attachment = keep(command)

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
        systemPrompts: {entries: [...PRESETS]},
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

  const {
    attachedTo,
    prompts = [],
    attachments = [],
    systemPromptId = SYSTEM_PROMPT_ID,
  } = setup

  const canvas = fromPartial<CanvasState>({
    index: indexTurns({prompts, replies: attachedTo ? [attachedTo] : []}),
    systemPromptId,
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

  function Input() {
    const [draft, setDraft] = useState<Draft>({...EMPTY_DRAFT, attachments})

    return (
      <PromptInput
        treeId={treeId}
        parentReplyId={attachedTo?.id ?? null}
        draft={draft}
        onDraftChange={setDraft}
      />
    )
  }

  await render(<Input />, {wrapper: Providers})

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
  'Switching to ChatGPT will re-read ~54k tokens of this conversation (uses more of your limit).'

it('says above the Input how much of a long Thread another Provider will re-read, once it’s picked', async () => {
  await renderInput({attachedTo: sized(49_000)})

  expect(page.getByRole('note').query()).toBeNull()

  await picker().click()
  await page.getByRole('option', {name: 'GPT-5'}).click()

  await expect.element(page.getByRole('note')).toHaveTextContent(SWITCH_NOTE)
})

it('says above the Input how much of a long Thread the Tree’s new System prompt will re-read', async () => {
  await renderInput({
    attachedTo: sized(49_000),
    systemPromptId: '019ab3c0-5e1f-7000-8000-000000000002',
  })

  await expect
    .element(page.getByRole('note'))
    .toHaveTextContent(
      'The new System prompt will re-read ~49k tokens of this conversation (uses more of your limit).'
    )
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
    .element(attachedFile(name).getByText('Reading…'))
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

function drop(files: File[]) {
  const data = dataOf(files)
  const input = page.getByRole('textbox', {name: 'Prompt'}).element()

  const over = new DragEvent('dragover', {
    dataTransfer: data,
    bubbles: true,
    cancelable: true,
  })

  input.dispatchEvent(over)
  input.dispatchEvent(
    new DragEvent('drop', {dataTransfer: data, bubbles: true, cancelable: true})
  )

  return over
}

it('attaches files dropped onto the Input by the id main gave each path', async () => {
  const main = await renderInput()

  expect(drop([textFile('dropped.txt', 'Dropped')]).defaultPrevented).toBe(true)

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
    .element(attachedFile('notes.txt').getByText('Reading…'))
    .toBeVisible()
  await expect.element(sendButton).toBeDisabled()

  await expect.poll(() => main.files.waiting.length).toBe(1)
  main.files.waiting[0]?.()
  await expect
    .element(attachedFile('notes.txt').getByText(/^10 bytes/))
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

  paste([new File([new Uint8Array(ATTACHMENT_SIZE_LIMIT + 1)], 'huge.bin')])

  await expect
    .element(attachedFile('huge.bin').getByRole('alert'))
    .toHaveTextContent('Larger than 50 MiB, the most one file can be')
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
  await renderInput({
    attachments: Array.from({length: ATTACHMENTS_PER_PROMPT + 2}, (_, at) =>
      kept(`${at}.txt`, 'text/plain', 6)
    ),
  })

  const sendButton = page.getByRole('button', {name: 'Send'})

  await expect.element(sendButton).toBeDisabled()
  await expect
    .element(page.getByText('A Prompt takes at most 100 files; remove 2.'))
    .toBeInTheDocument()

  await page.getByRole('button', {name: 'Remove 0.txt'}).click()
  await page.getByRole('button', {name: 'Remove 1.txt'}).click()
  await expect.element(sendButton).toBeEnabled()
})

it('holds Send, saying why, while the Input’s images come to more than a Prompt takes inline', async () => {
  await renderInput({
    attachments: Array.from({length: 9}, (_, at) =>
      kept(`${at}.png`, 'image/png', 50 * 1024 * 1024, {
        shrunkSize: INLINE_IMAGE_SIZE_LIMIT,
      })
    ),
  })

  const sendButton = page.getByRole('button', {name: 'Send'})

  await expect.element(sendButton).toBeDisabled()
  await expect
    .element(
      page.getByText('A Prompt takes at most 80 MiB of images; remove some.')
    )
    .toBeInTheDocument()

  await page.getByRole('button', {name: 'Remove 0.png'}).click()
  await expect.element(sendButton).toBeEnabled()
  await expect
    .element(page.getByText(/A Prompt takes at most/))
    .not.toBeInTheDocument()
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
    .element(attachedFile('notes.pdf').getByText(/^2 KiB/))
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

function description(name: string) {
  return attachedFile(name).getByText(
    / · |The AI|Sent as|Claude reads|Unimatrix Zero/
  )
}

const DRAFTED = [
  kept('shot.png', 'image/png', 3),
  kept('paper.pdf', 'application/pdf', 2048),
  kept('notes.txt', 'text/plain', INLINE_TEXT_SIZE_LIMIT),
  kept('log.txt', 'text/plain', INLINE_TEXT_SIZE_LIMIT + 1),
  kept('archive.zip', 'application/zip', 4096),
  kept('project', 'inode/directory', 0, {folderPath: '/Users/sam/project'}),
]

it('says on each file what the picked Model does with it, and says it again for another Provider’s Model once picked', async () => {
  await renderInput({
    attachedTo: attachedReply('claude', 'opus-4-7'),
    attachments: DRAFTED,
  })

  await expect
    .element(description('paper.pdf'))
    .toHaveTextContent('2 KiB · Claude reads the whole PDF')
  await expect
    .element(description('notes.txt'))
    .toHaveTextContent('32 KiB · Sent as text')
  await expect
    .element(description('log.txt'))
    .toHaveTextContent('32 KiB · The AI can open this file')
  await expect
    .element(description('archive.zip'))
    .toHaveTextContent('4 KiB · The AI can open this file')
  await expect
    .element(description('project'))
    .toHaveTextContent('The AI can open this folder')
  await expect
    .element(page.getByRole('button', {name: 'Open shot.png'}))
    .toHaveAccessibleDescription('Sent as an image')

  await picker().click()
  await page.getByRole('option', {name: 'GPT-5'}).click()

  await expect
    .element(description('paper.pdf'))
    .toHaveTextContent('2 KiB · The AI can open this file')
  await expect
    .element(description('notes.txt'))
    .toHaveTextContent('32 KiB · Sent as text')
  await expect
    .element(page.getByRole('button', {name: 'Open shot.png'}))
    .toHaveAccessibleDescription('Sent as an image')
})

it('says a PDF goes by path when the Prompt alone passes Claude’s media budget, oldest first', async () => {
  const MIB = 1024 * 1024

  await renderInput({
    attachedTo: attachedReply('claude', 'opus-4-7'),
    attachments: [
      kept('first.pdf', 'application/pdf', 9 * MIB),
      kept('second.pdf', 'application/pdf', 9 * MIB),
    ],
  })

  await expect
    .element(description('first.pdf'))
    .toHaveTextContent('9 MiB · The AI can open this file')
  await expect
    .element(description('second.pdf'))
    .toHaveTextContent('9 MiB · Claude reads the whole PDF')
})

function readByApp(
  text: boolean,
  pageImages: number[] = [],
  imagesStopped = false
): Attachment['extraction'] {
  return {status: 'read', version: 1, text, pageImages, imagesStopped}
}

it('says what the AI reads of a file the app read, that page images stopped at 100, and that the app couldn’t read a file', async () => {
  const hundred = Array.from({length: 100}, (_, at) => at + 1)

  await renderInput({
    attachedTo: attachedReply('chatgpt', 'gpt-5'),
    attachments: [
      kept('report.docx', 'application/octet-stream', 2048, {
        extraction: readByApp(true),
      }),
      kept('scan.pdf', 'application/pdf', 2048, {
        extraction: readByApp(false, [1, 2, 3]),
      }),
      kept('paper.pdf', 'application/pdf', 2048, {
        extraction: readByApp(true, [4]),
      }),
      kept('book.pdf', 'application/pdf', 2048, {
        extraction: readByApp(true, hundred, true),
      }),
      kept('long-scan.pdf', 'application/pdf', 2048, {
        extraction: readByApp(false, hundred, true),
      }),
      kept('broken.xlsx', 'application/octet-stream', 2048, {
        extraction: {status: 'failed', version: 1},
      }),
    ],
  })

  await expect
    .element(description('report.docx'))
    .toHaveTextContent('2 KiB · The AI reads its text')
  await expect
    .element(description('scan.pdf'))
    .toHaveTextContent('2 KiB · The AI reads 3 page images')
  await expect
    .element(description('paper.pdf'))
    .toHaveTextContent('2 KiB · The AI reads its text and 1 page image')
  await expect
    .element(description('book.pdf'))
    .toHaveTextContent(
      '2 KiB · The AI reads its text and 100 page images; later pages as text only'
    )
  await expect
    .element(description('long-scan.pdf'))
    .toHaveTextContent(
      '2 KiB · The AI reads 100 page images; later pages not read'
    )
  await expect
    .element(description('broken.xlsx'))
    .toHaveTextContent(
      '2 KiB · Unimatrix Zero couldn’t read this file; the AI can still open it'
    )
})

it('says what the Model does with an image in a tooltip on its thumbnail', async () => {
  await renderInput({attachments: DRAFTED})

  await page.getByRole('button', {name: 'Open shot.png'}).hover()

  await expect
    .poll(
      () => document.querySelector('[data-slot=tooltip-content]')?.textContent
    )
    .toBe('Sent as an image')
})

it('shows each file’s size alone until a Model is picked', async () => {
  await renderInput({
    attachments: DRAFTED,
    models: {claude: [], chatgpt: []},
  })

  await expect
    .element(attachedFile('paper.pdf').getByText('2 KiB', {exact: true}))
    .toBeVisible()
  expect(description('paper.pdf').query()).toBeNull()
  expect(description('project').query()).toBeNull()
  await expect
    .element(page.getByRole('button', {name: 'Open shot.png'}))
    .toHaveAccessibleDescription('')
})

it('attaches a file of any type, offering every file in the chooser', async () => {
  const main = await renderInput()

  await attach(
    new File([new Uint8Array(4096)], 'archive.zip', {type: 'application/zip'}),
    new File([new Uint8Array(8)], 'core', {type: ''})
  )

  expect(main.files.added.map(({name}) => name)).toEqual([
    'archive.zip',
    'core',
  ])
  expect(page.getByRole('alert').query()).toBeNull()
  await expect
    .element(page.getByLabelText('Files to attach'))
    .not.toHaveAttribute('accept')
})

it('shows a dropped folder as a chip with its name and path, with no size or thumbnail, and removes it like any file', async () => {
  const main = await renderInput()

  main.files.folders.set('project', '/Users/sam/project')
  drop([new File([], 'project', {type: ''})])
  await expectAdded('project')

  const chip = attachedFile('project')

  await expect.element(chip.getByText('/Users/sam/project')).toBeVisible()
  await expect
    .element(chip.getByText('The AI can open this folder'))
    .toBeVisible()
  expect(chip.getByText(/bytes/).query()).toBeNull()
  expect(chip.getByRole('img').query()).toBeNull()
  expect(addedCommands(main)).toEqual([
    {
      type: 'attachment.add',
      file: {type: 'dropped', fileId: [...main.files.byId.keys()][0]},
    },
  ])

  await page.getByRole('button', {name: 'Remove project'}).click()
  await expect.element(chip).not.toBeInTheDocument()
})

async function canvasImage(name: string, width: number, height: number) {
  const canvas = new OffscreenCanvas(width, height)

  canvas.getContext('2d')?.fillRect(0, 0, width, height)

  return new File([await canvas.convertToBlob({type: 'image/png'})], name, {
    type: 'image/png',
  })
}

function addedCommands(main: ReturnType<typeof fakeMain>) {
  return main.sent.filter(command => command.type === 'attachment.add')
}

it('sends main a smaller copy with an image too large to go inline, none with one that fits, and attaches an image it can’t read all the same', async () => {
  const main = await renderInput()

  drop([
    await canvasImage('wide.png', INLINE_IMAGE_PIXELS * 2, 20),
    await canvasImage('small.png', 20, 20),
    new File(['Not an image'], 'broken.png', {type: 'image/png'}),
  ])
  await expectAdded('wide.png')
  await expectAdded('small.png')
  await expectAdded('broken.png')

  const [wide, small, broken] = addedCommands(main)
  const copy = await createImageBitmap(new Blob([wide?.shrunk ?? '']))

  expect([copy.width, copy.height]).toEqual([INLINE_IMAGE_PIXELS, 10])
  expect(small).not.toHaveProperty('shrunk')
  expect(broken).not.toHaveProperty('shrunk')
  expect(main.files.added.map(({shrunkSize}) => shrunkSize)).toEqual([
    wide?.shrunk?.byteLength,
    null,
    null,
  ])
})

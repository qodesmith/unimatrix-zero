import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {HostCommand} from '@uz/contract/host'
import type {TreeTools} from '@uz/contract/tools'

import {createAttachments} from '#modules/attachments/main'
import {createConnections} from '#modules/connections/main'
import {openDatabase} from '#modules/database/main'
import {createLayout} from '#modules/layout/main'
import {createSettings} from '#modules/settings/main'
import {createSystemPrompts} from '#modules/system-prompts/main'
import {createTreeRows, createTrees} from '#modules/trees/main'
import {createTurns} from '#modules/turns/main'
import {
  AttachmentAddResult,
  PromptSendResult,
  TreeListResult,
  TreeTurnsResult,
} from '@uz/contract/commands'
import {DEFAULT_LAYOUT} from '@uz/contract/layout'
import {PRESETS, SystemPromptEntrySchema} from '@uz/contract/system-prompts'
import {DEFAULT_TREE_TOOLS} from '@uz/contract/tools'
import {TREE_TITLE_MAX_LENGTH, TreeSchema} from '@uz/contract/trees'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {dispatchCommand} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')
const trusted = {isTopLevelAppFrame: true}
const picked = {provider: 'claude', model: 'fake'} as const

let clock: Date

function now() {
  return clock
}

let published: AppEvent[]
let hostCommands: HostCommand[]
let hostReachable: boolean
let loaded: string[]
let deps: Parameters<typeof dispatchCommand>[2]
let attachmentsDir: string

let treeHasFiles: boolean
let downloadsAgain: number

beforeEach(() => {
  treeHasFiles = false
  downloadsAgain = 0
  const db = openDatabase({file: ':memory:', migrationsFolder})
  attachmentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-commands-'))
  clock = new Date('2026-10-19T12:00:00.000Z')
  published = []
  hostCommands = []
  hostReachable = true
  loaded = []

  function publish(event: AppEvent) {
    published.push(event)
  }

  function sendToHost(_provider: string, command: HostCommand) {
    if (!hostReachable) throw new Error('The claude host is not running.')

    hostCommands.push(command)
  }

  const trees = createTrees(db)
  const rows = createTreeRows(trees, publish)
  const settings = createSettings(db)

  deps = {
    now,
    trees,
    turns: createTurns({
      db,
      publish,
      hosts: {
        ready: provider => provider === 'claude',
        send: sendToHost,
      },
      vendorProgramFor: () => ({program: null, configDir: '/claude'}),
      treeFolderFor: id => `/trees/${id}`,
      snapshotsBefore: () => null,
      compactionSettingsFor: () => ({auto: true, threshold: null}),
      permissionMode: () => 'supervised',
      sandboxFolders: {hiddenFolders: [], treesFolder: '/trees'},
      listedModels: () => [],
      attachmentsDir,
      now,
      onTurnsChanged: rows.turnsChanged,
      onReplyFinished: rows.replyFinished,
    }),
    treeFiles: {
      withChangedFiles: async (treeId, replies) =>
        treeHasFiles
          ? replies.map(reply => ({
              ...reply,
              files: [{path: `${treeId}.md`, change: 'created', size: 1}],
            }))
          : replies,
      listFiles: async () => null,
      saveFilesCopy: async () => null,
      describeFile: async () => null,
      openFile: async () => false,
      revealFile: async () => false,
      saveFileCopy: async () => null,
      thumbnail: async () => null,
    },
    connections: createConnections({
      db,
      hosts: {
        connect: () => undefined,
        send: sendToHost,
        stop: () => undefined,
      },
      publish,
      requestFor: provider =>
        provider === 'claude' ? {program: null, configDir: '/claude'} : null,
      openExternal: () => undefined,
      now,
    }),
    attachments: createAttachments({
      db,
      dir: attachmentsDir,
      droppedPath: () => null,
      extract: async () => ({type: 'unsupported'}),
    }),
    images: {
      load: async url => {
        loaded.push(url)

        return {dataUrl: 'data:image/png;base64,iVBORw0KGgo='}
      },
    },
    settings,
    systemPrompts: createSystemPrompts(db, settings),
    layout: createLayout(db),
    downloadGitAgain: () => {
      downloadsAgain += 1
    },
    publish,
  }
})

afterEach(() => {
  fs.rmSync(attachmentsDir, {recursive: true, force: true})
})

function bytesOf(text: string) {
  return new TextEncoder().encode(text)
}

type Sent = Command | {type: 'app.ping'; nonce: string; extra: true}

async function send(raw: Sent) {
  return dispatchCommand(raw, trusted, deps)
}

async function createTree() {
  const outcome = await send({type: 'tree.create'})

  if (!outcome.ok) throw new Error(outcome.error.message)

  return TreeSchema.parse(outcome.value)
}

async function sendPrompt(
  treeId: string,
  parentReplyId: string | null,
  text = 'Hi'
) {
  const outcome = await send({
    type: 'prompt.send',
    model: picked,
    treeId,
    parentReplyId,
    text,
  })

  if (!outcome.ok) throw new Error(outcome.error.message)

  return PromptSendResult.parse(outcome.value)
}

function answer(treeId: string, replyId: string) {
  deps.turns.hostRecorded('claude', {
    type: 'REPLY_RECORDED',
    treeId,
    replyId,
    model: 'fake',
    session: {sessionId: 's1', messageId: replyId},
  })
  deps.turns.hostEvent('claude', {
    type: 'RUN_FINISHED',
    treeId,
    replyId,
    status: 'complete',
  })
}

async function listed() {
  const outcome = await send({type: 'tree.list'})

  if (!outcome.ok) throw new Error(outcome.error.message)

  return TreeListResult.parse(outcome.value).trees
}

function changed() {
  return published.flatMap(event =>
    event.type === 'TREE_CHANGED' ? [event.tree] : []
  )
}

describe('app.ping', () => {
  it('round-trips the nonce with the time main received it', async () => {
    const outcome = await send({type: 'app.ping', nonce: 'n-1'})

    expect(outcome).toEqual({
      ok: true,
      value: {nonce: 'n-1', receivedAt: '2026-10-19T12:00:00.000Z'},
    })
  })

  it('rejects a command carrying an unknown key', async () => {
    const outcome = await send({type: 'app.ping', nonce: 'n-1', extra: true})
    expect(outcome).toMatchObject({ok: false, error: {code: 'invalid-command'}})
  })

  it('refuses a sender that is not the top-level app frame', async () => {
    const outcome = await dispatchCommand(
      {type: 'app.ping', nonce: 'n-1'},
      {isTopLevelAppFrame: false},
      deps
    )

    expect(outcome).toMatchObject({
      ok: false,
      error: {code: 'untrusted-sender'},
    })
  })
})

describe('Trees', () => {
  it('creates an untitled Tree and tells every window', async () => {
    const tree = await createTree()

    expect(tree).toMatchObject({
      title: null,
      createdAt: '2026-10-19T12:00:00.000Z',
    })
    expect(published).toEqual([{type: 'TREE_CREATED', tree}])
  })

  it('lists Trees newest first', async () => {
    const first = await createTree()
    clock = new Date('2026-10-20T12:00:00.000Z')
    const second = await createTree()

    expect(await send({type: 'tree.list'})).toEqual({
      ok: true,
      value: {trees: [second, first]},
    })
  })

  it('answers not-found for a Tree that does not exist', async () => {
    const outcome = await send({
      type: 'tree.open',
      treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
    })

    expect(outcome).toMatchObject({ok: false, error: {code: 'not-found'}})
  })

  it('renames a Tree, trimmed, and tells every window', async () => {
    const tree = await createTree()

    const outcome = await send({
      type: 'tree.rename',
      treeId: tree.id,
      title: '  Trip planning ',
    })

    const renamed = {...tree, title: 'Trip planning'}

    expect(outcome).toEqual({ok: true, value: renamed})
    expect(published.at(-1)).toEqual({type: 'TREE_CHANGED', tree: renamed})
    expect(await send({type: 'tree.list'})).toEqual({
      ok: true,
      value: {trees: [renamed]},
    })
  })

  it('refuses a blank title', async () => {
    const tree = await createTree()

    const outcome = await send({
      type: 'tree.rename',
      treeId: tree.id,
      title: '   ',
    })

    expect(outcome).toMatchObject({ok: false, error: {code: 'invalid-command'}})
  })
})

describe('a Tree’s row', () => {
  it('shows the root Prompt’s first line and when the last Prompt was sent, and tells every window as each is sent', async () => {
    const tree = await createTree()
    clock = new Date('2026-10-19T13:00:00.000Z')

    const root = await sendPrompt(
      tree.id,
      null,
      '\n   \n  Plan a trip to Lisbon  \nin May'
    )

    answer(tree.id, root.reply.id)
    clock = new Date('2026-10-19T14:00:00.000Z')
    await sendPrompt(tree.id, root.reply.id, 'Make it cheaper')

    const first = {
      ...tree,
      firstLine: 'Plan a trip to Lisbon',
      lastActiveAt: '2026-10-19T13:00:00.000Z',
    }

    const second = {
      ...first,
      lastActiveAt: '2026-10-19T14:00:00.000Z',
    }

    expect(tree).toMatchObject({
      firstLine: null,
      lastActiveAt: '2026-10-19T12:00:00.000Z',
      unseenFailure: false,
    })
    expect(await listed()).toEqual([second])
    expect(changed()).toEqual([first, second])
  })

  it('cuts a long first line to the longest title', async () => {
    const tree = await createTree()
    await sendPrompt(
      tree.id,
      null,
      `${'a'.repeat(TREE_TITLE_MAX_LENGTH + 1)}\nmore`
    )

    expect((await listed())[0]?.firstLine).toBe(
      'a'.repeat(TREE_TITLE_MAX_LENGTH)
    )
  })

  it('lists the Tree last active first', async () => {
    const older = await createTree()
    clock = new Date('2026-10-20T12:00:00.000Z')
    const newer = await createTree()
    clock = new Date('2026-10-21T12:00:00.000Z')
    await sendPrompt(older.id, null)

    expect((await listed()).map(tree => tree.id)).toEqual([older.id, newer.id])
  })

  it('tells every window when a Prompt is deleted', async () => {
    const tree = await createTree()
    clock = new Date('2026-10-19T13:00:00.000Z')
    const root = await sendPrompt(tree.id, null)
    answer(tree.id, root.reply.id)
    clock = new Date('2026-10-19T14:00:00.000Z')
    const next = await sendPrompt(tree.id, root.reply.id)
    answer(tree.id, next.reply.id)

    await send({
      type: 'prompt.delete',
      treeId: tree.id,
      promptId: next.prompt.id,
    })

    const lastActiveAt = '2026-10-19T13:00:00.000Z'

    expect(changed().at(-1)).toMatchObject({id: tree.id, lastActiveAt})
    expect((await listed())[0]?.lastActiveAt).toBe(lastActiveAt)
  })

  it.each([
    [
      'its host reports it failed',
      (treeId: string, replyId: string) =>
        deps.turns.hostEvent('claude', {
          type: 'RUN_FINISHED',
          treeId,
          replyId,
          status: 'failed',
          failure: {code: 'provider-error', message: 'Overloaded.'},
        }),
    ],
    ['its host crashes', () => deps.turns.hostCrashed('claude')],
  ])(
    'has an unseen failure once a Reply fails as %s, until the Tree is opened',
    async (_case, failIt) => {
      const tree = await createTree()
      const {reply} = await sendPrompt(tree.id, null)
      failIt(tree.id, reply.id)

      expect(changed().at(-1)).toMatchObject({
        id: tree.id,
        unseenFailure: true,
      })
      expect((await listed())[0]?.unseenFailure).toBe(true)

      const opened = await send({type: 'tree.open', treeId: tree.id})
      const [seen] = await listed()

      expect(seen?.unseenFailure).toBe(false)
      expect(opened).toEqual({ok: true, value: seen})
      expect(published.at(-1)).toMatchObject({
        type: 'TREE_CHANGED',
        tree: {id: tree.id, unseenFailure: false},
      })

      const count = published.length
      const openedAgain = await send({type: 'tree.open', treeId: tree.id})

      expect(openedAgain).toEqual({ok: true, value: seen})
      expect(published).toHaveLength(count)
    }
  )

  it('has an unseen failure when the host can’t be reached', async () => {
    const tree = await createTree()
    hostReachable = false
    await sendPrompt(tree.id, null)

    expect((await listed())[0]?.unseenFailure).toBe(true)
  })
})

describe('deleting a Tree', () => {
  it('deletes it with its Turns and tells every window', async () => {
    const tree = await createTree()
    const root = await sendPrompt(tree.id, null)
    answer(tree.id, root.reply.id)
    await sendPrompt(tree.id, root.reply.id)

    expect(await send({type: 'tree.delete', treeId: tree.id})).toEqual({
      ok: true,
      value: {},
    })
    expect(published.at(-1)).toEqual({type: 'TREE_DELETED', treeId: tree.id})
    expect(await listed()).toEqual([])
    expect(deps.turns.list(tree.id)).toEqual({prompts: [], replies: []})
  })

  it('ends each Reply streaming in it, asks its host to stop, and deletes it at once', async () => {
    const tree = await createTree()
    const root = await sendPrompt(tree.id, null)
    answer(tree.id, root.reply.id)
    const first = await sendPrompt(tree.id, root.reply.id)
    const second = await sendPrompt(tree.id, root.reply.id)
    hostCommands = []

    expect(await send({type: 'tree.delete', treeId: tree.id})).toEqual({
      ok: true,
      value: {},
    })
    expect(hostCommands).toEqual([
      {type: 'reply.stop', replyId: first.reply.id},
      {type: 'reply.stop', replyId: second.reply.id},
    ])
    expect(published.slice(-3)).toEqual([
      {
        type: 'RUN_FINISHED',
        treeId: tree.id,
        replyId: first.reply.id,
        status: 'stopped',
      },
      {
        type: 'RUN_FINISHED',
        treeId: tree.id,
        replyId: second.reply.id,
        status: 'stopped',
      },
      {type: 'TREE_DELETED', treeId: tree.id},
    ])
    expect(await listed()).toEqual([])
  })

  it('answers not-found for a Tree that does not exist', async () => {
    expect(
      await send({type: 'tree.delete', treeId: crypto.randomUUID()})
    ).toMatchObject({ok: false, error: {code: 'not-found'}})
  })
})

describe('Reply commands', () => {
  it('sends a Prompt, which the Tree’s Turns then list', async () => {
    const tree = await createTree()

    const outcome = await send({
      type: 'prompt.send',
      model: picked,
      treeId: tree.id,
      parentReplyId: null,
      text: ' Hello ',
    })

    if (!outcome.ok) throw new Error(outcome.error.message)

    const {prompt, reply} = PromptSendResult.parse(outcome.value)

    expect(prompt.text).toBe('Hello')
    expect(hostCommands).toMatchObject([
      {type: 'reply.start', request: {replyId: reply.id}},
    ])
    expect(await send({type: 'tree.turns', treeId: tree.id})).toEqual({
      ok: true,
      value: {prompts: [prompt], replies: [reply]},
    })
  })

  it('lists each Reply with the files the Tree’s files say it changed', async () => {
    const tree = await createTree()
    await send({
      type: 'prompt.send',
      model: picked,
      treeId: tree.id,
      parentReplyId: null,
      text: 'Write it down',
    })
    treeHasFiles = true

    expect(await send({type: 'tree.turns', treeId: tree.id})).toMatchObject({
      ok: true,
      value: {replies: [{files: [{path: `${tree.id}.md`}]}]},
    })
  })

  it.each([
    [
      'a Tree that does not exist',
      async () => ({treeId: crypto.randomUUID(), parentReplyId: null}),
    ],
    [
      'a Reply the Tree doesn’t have',
      async () => ({
        treeId: (await createTree()).id,
        parentReplyId: crypto.randomUUID(),
      }),
    ],
  ])('answers not-found for a Prompt into %s', async (_case, where) => {
    expect(
      await send({
        type: 'prompt.send',
        model: picked,
        ...(await where()),
        text: 'Hi',
      })
    ).toMatchObject({ok: false, error: {code: 'not-found'}})
  })

  it('stops a streaming Reply, and answers with why it can’t', async () => {
    const tree = await createTree()

    const sent = await send({
      type: 'prompt.send',
      model: picked,
      treeId: tree.id,
      parentReplyId: null,
      text: 'Hi',
    })

    if (!sent.ok) throw new Error(sent.error.message)

    const {reply} = PromptSendResult.parse(sent.value)

    const stop = {
      type: 'reply.stop',
      treeId: tree.id,
      replyId: reply.id,
    } as const

    expect(await send(stop)).toEqual({ok: true, value: {}})
    expect(hostCommands.at(-1)).toEqual({type: 'reply.stop', replyId: reply.id})
    expect(await send({...stop, replyId: crypto.randomUUID()})).toEqual({
      ok: false,
      error: {
        code: 'handler-failed',
        message: 'That Reply isn’t being written.',
      },
    })
  })

  it('answers an approval card, keeping Always allow for the Tree’s later Replies, and answers not-found for one no longer waiting', async () => {
    const tree = await createTree()
    const {reply} = await sendPrompt(tree.id, null)
    deps.turns.hostEvent('claude', {
      type: 'APPROVAL_REQUESTED',
      treeId: tree.id,
      replyId: reply.id,
      approvalId: 'a1',
      action: {kind: 'host', host: 'example.com'},
    })
    hostCommands = []

    const answered = {
      type: 'reply.answer-approval',
      treeId: tree.id,
      replyId: reply.id,
      approvalId: 'a1',
      answer: 'always-allow',
    } as const

    expect(await send(answered)).toEqual({ok: true, value: {}})
    expect(hostCommands).toEqual([
      {type: 'approval.answer', approvalId: 'a1', answer: 'always-allow'},
    ])

    answer(tree.id, reply.id)
    hostCommands = []

    expect(await send(answered)).toMatchObject({
      ok: false,
      error: {code: 'not-found'},
    })

    await sendPrompt(tree.id, reply.id)

    expect(hostCommands).toMatchObject([
      {
        type: 'reply.start',
        request: {
          permissionMode: 'supervised',
          grants: [{kind: 'host', host: 'example.com'}],
        },
      },
    ])
  })

  it('answers not-found for retrying a Reply the Tree doesn’t have', async () => {
    const tree = await createTree()

    expect(
      await send({
        type: 'reply.retry',
        treeId: tree.id,
        replyId: crypto.randomUUID(),
      })
    ).toMatchObject({ok: false, error: {code: 'not-found'}})
  })

  it('answers not-found for deleting a Prompt the Tree doesn’t have', async () => {
    const tree = await createTree()

    expect(
      await send({
        type: 'prompt.delete',
        treeId: tree.id,
        promptId: crypto.randomUUID(),
      })
    ).toMatchObject({
      ok: false,
      error: {code: 'not-found', message: 'That Prompt no longer exists.'},
    })
  })
})

describe('attachments', () => {
  it('attaches a pasted file, which a Prompt with no text then sends and lists, leaving its Tree no first line', async () => {
    const tree = await createTree()

    const added = await send({
      type: 'attachment.add',
      file: {type: 'pasted', name: 'notes.txt', bytes: bytesOf('Hello')},
    })

    if (!added.ok) throw new Error(added.error.message)

    const {attachment} = AttachmentAddResult.parse(added.value)

    const sent = await send({
      type: 'prompt.send',
      model: picked,
      treeId: tree.id,
      parentReplyId: null,
      text: '',
      attachmentIds: [attachment.id],
    })

    expect(attachment).toEqual({
      id: expect.any(String),
      name: 'notes.txt',
      mediaType: 'text/plain',
      size: 5,
      shrunkSize: null,
      folderPath: null,
      missing: false,
      extraction: null,
    })
    expect(sent).toMatchObject({
      ok: true,
      value: {prompt: {text: '', attachments: [attachment]}},
    })
    expect(await send({type: 'tree.turns', treeId: tree.id})).toMatchObject({
      ok: true,
      value: {prompts: [{attachments: [attachment]}]},
    })
    expect((await listed())[0]?.firstLine).toBeNull()
  })

  it('lists a sent file whose copy is gone as missing', async () => {
    const tree = await createTree()

    const added = await send({
      type: 'attachment.add',
      file: {type: 'pasted', name: 'notes.txt', bytes: bytesOf('Hello')},
    })

    if (!added.ok) throw new Error(added.error.message)

    const {attachment} = AttachmentAddResult.parse(added.value)

    await send({
      type: 'prompt.send',
      model: picked,
      treeId: tree.id,
      parentReplyId: null,
      text: '',
      attachmentIds: [attachment.id],
    })
    fs.rmSync(attachmentsDir, {recursive: true})

    expect(await send({type: 'tree.turns', treeId: tree.id})).toMatchObject({
      ok: true,
      value: {prompts: [{attachments: [{id: attachment.id, missing: true}]}]},
    })
  })

  it('answers a send with each file whose copy is gone marked missing, so a Reply that fails at once still shows why', async () => {
    const tree = await createTree()

    const added = await send({
      type: 'attachment.add',
      file: {type: 'pasted', name: 'notes.txt', bytes: bytesOf('Hello')},
    })

    if (!added.ok) throw new Error(added.error.message)

    const {attachment} = AttachmentAddResult.parse(added.value)
    fs.rmSync(attachmentsDir, {recursive: true})

    expect(
      await send({
        type: 'prompt.send',
        model: picked,
        treeId: tree.id,
        parentReplyId: null,
        text: '',
        attachmentIds: [attachment.id],
      })
    ).toMatchObject({
      ok: true,
      value: {prompt: {attachments: [{id: attachment.id, missing: true}]}},
    })
  })
})

describe('attaching an image with the window’s shrunk copy', () => {
  it('keeps the shrunk copy with the original', async () => {
    const added = await send({
      type: 'attachment.add',
      file: {
        type: 'pasted',
        name: 'photo.png',
        bytes: Uint8Array.from([
          0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
        ]),
      },
      shrunk: Uint8Array.from([0xff, 0xd8, 0xff]),
    })

    expect(added).toMatchObject({
      ok: true,
      value: {attachment: {mediaType: 'image/png', size: 8, shrunkSize: 3}},
    })
  })
})

describe('file history', () => {
  it('starts the download of the app’s git again on Try again', async () => {
    expect(await send({type: 'snapshots.download-again'})).toEqual({
      ok: true,
      value: {},
    })
    expect(downloadsAgain).toBe(1)
  })
})

describe('the Tree’s files', () => {
  const fileId = '0'.repeat(32)

  it.each([
    {type: 'tree-file.describe', fileId},
    {type: 'tree-file.open', fileId, with: 'default-app'},
    {type: 'tree-file.reveal', fileId},
    {type: 'tree-file.save-copy', fileId},
    {type: 'tree-file.thumbnail', fileId},
  ] as const)(
    'answers not-found for $type of a file main never listed',
    async command => {
      expect(await send(command)).toMatchObject({
        ok: false,
        error: {code: 'not-found'},
      })
    }
  )

  it.each(['tree-files.list', 'tree-files.save-copy'] as const)(
    'answers not-found for %s of a Tree or a Reply that doesn’t exist',
    async type => {
      const tree = await createTree()

      expect(
        await send({
          type,
          treeId: crypto.randomUUID(),
          replyId: crypto.randomUUID(),
        })
      ).toMatchObject({
        ok: false,
        error: {code: 'not-found', message: 'That Tree no longer exists.'},
      })
      expect(
        await send({type, treeId: tree.id, replyId: crypto.randomUUID()})
      ).toMatchObject({
        ok: false,
        error: {code: 'not-found', message: 'That Reply no longer exists.'},
      })
    }
  )
})

describe('connecting a Provider', () => {
  it('asks the Provider’s host to connect, then passes on what the user does', async () => {
    expect(await send({type: 'provider.connect', provider: 'claude'})).toEqual({
      ok: true,
      value: {},
    })
    await send({type: 'sign-in.code', provider: 'claude', code: ' code#s '})
    await send({type: 'sign-in.cancel', provider: 'claude'})

    expect(hostCommands).toEqual([
      {type: 'sign-in.start', request: {program: null, configDir: '/claude'}},
      {type: 'sign-in.code', code: 'code#s'},
      {type: 'sign-in.cancel'},
    ])
  })

  it('refuses an empty code', async () => {
    expect(
      await send({type: 'sign-in.code', provider: 'claude', code: '  '})
    ).toMatchObject({ok: false, error: {code: 'invalid-command'}})
  })
})

describe('loading a remote image', () => {
  it('fetches an http or https link and hands back what main fetched', async () => {
    const https = await send({
      type: 'image.load',
      url: 'https://a.example/1.png',
    })

    await send({type: 'image.load', url: 'http://b.example/2.png'})

    expect(loaded).toEqual([
      'https://a.example/1.png',
      'http://b.example/2.png',
    ])

    expect(https).toEqual({ok: true, value: {dataUrl: expect.any(String)}})
  })

  it('refuses any link that is not http or https, fetching nothing', async () => {
    expect(
      await send({type: 'image.load', url: 'file:///etc/passwd'})
    ).toMatchObject({ok: false, error: {code: 'invalid-command'}})
    expect(loaded).toEqual([])
  })
})

describe('the Layout', () => {
  it('saves a change and tells every window the Layout as now saved', async () => {
    const outcome = await send({
      type: 'layout.update',
      changes: {sidebarOpen: false},
    })

    const saved = {...DEFAULT_LAYOUT, sidebarOpen: false}

    expect(outcome).toEqual({ok: true, value: saved})
    expect(published).toEqual([{type: 'LAYOUT_CHANGED', layout: saved}])
  })
})

const DEFAULT_PRESET = /^You are a helpful assistant/

async function ownEntry(text: string) {
  const outcome = await send({type: 'system-prompt.create', name: 'Mine', text})

  if (!outcome.ok) throw new Error(outcome.error.message)

  return SystemPromptEntrySchema.parse(outcome.value)
}

async function setDefault(id: string) {
  await send({type: 'settings.update', changes: {defaultSystemPromptId: id}})
}

async function setSystemPrompt(treeId: string, text: string) {
  const outcome = await send({type: 'tree.set-system-prompt', treeId, text})

  if (!outcome.ok) throw new Error(outcome.error.message)

  return TreeSchema.parse(outcome.value)
}

function sentSystemPrompts() {
  return hostCommands.flatMap(command =>
    command.type === 'reply.start' ? [command.request.systemPrompt] : []
  )
}

async function repliesOf(treeId: string) {
  const outcome = await send({type: 'tree.turns', treeId})

  if (!outcome.ok) throw new Error(outcome.error.message)

  return TreeTurnsResult.parse(outcome.value).replies
}

describe('System prompts', () => {
  it('saves the user’s own after the presets and tells every window the library', async () => {
    const entry = await ownEntry('Talk like a pirate.')

    const updated = await send({
      type: 'system-prompt.update',
      id: entry.id,
      name: 'Pirate',
      text: 'Talk like a sailor.',
    })

    expect(updated).toEqual({
      ok: true,
      value: {...entry, name: 'Pirate', text: 'Talk like a sailor.'},
    })
    expect(
      published.map(event =>
        event.type === 'SYSTEM_PROMPTS_CHANGED'
          ? event.systemPrompts.entries
              .slice(PRESETS.length)
              .map(one => one.text)
          : event.type
      )
    ).toEqual([['Talk like a pirate.'], ['Talk like a sailor.']])
  })

  it('answers not-found for an entry the library doesn’t have', async () => {
    const id = crypto.randomUUID()

    expect(
      await send({type: 'system-prompt.update', id, name: 'Gone', text: ''})
    ).toMatchObject({ok: false, error: {code: 'not-found'}})
    expect(await send({type: 'system-prompt.delete', id})).toMatchObject({
      ok: false,
      error: {code: 'not-found'},
    })
  })

  it('refuses to change or delete a preset, telling no window anything', async () => {
    expect(
      await send({
        type: 'system-prompt.update',
        id: 'concise',
        name: 'Mine',
        text: 'x',
      })
    ).toMatchObject({ok: false, error: {code: 'handler-failed'}})
    expect(
      await send({type: 'system-prompt.delete', id: 'default'})
    ).toMatchObject({ok: false, error: {code: 'handler-failed'}})
    expect(published).toEqual([])
  })

  it('gives a new Tree a copy of the default, which no later change to the library or the default touches', async () => {
    const entry = await ownEntry('Talk like a pirate.')
    await setDefault(entry.id)
    const tree = await createTree()

    await send({
      type: 'system-prompt.update',
      id: entry.id,
      name: 'Pirate',
      text: 'Talk like a sailor.',
    })
    await setDefault('concise')
    await send({type: 'system-prompt.delete', id: entry.id})

    expect(tree.systemPrompt.text).toBe('Talk like a pirate.')
    expect(await listed()).toEqual([tree])
  })

  it('falls back to the Default preset once the default is deleted, and tells every window the library and the Setting', async () => {
    const entry = await ownEntry('Talk like a pirate.')
    await setDefault(entry.id)
    published = []

    await send({type: 'system-prompt.delete', id: entry.id})

    expect(published).toEqual([
      {type: 'SYSTEM_PROMPTS_CHANGED', systemPrompts: {entries: PRESETS}},
      {
        type: 'SETTINGS_CHANGED',
        settings: expect.objectContaining({defaultSystemPromptId: 'default'}),
      },
    ])
    expect((await createTree()).systemPrompt.text).toMatch(DEFAULT_PRESET)
  })

  it('sends a changed System prompt with the Tree’s later Replies, while each earlier one keeps what it ran under', async () => {
    const tree = await createTree()
    const first = await sendPrompt(tree.id, null)
    answer(tree.id, first.reply.id)

    const changedTree = await setSystemPrompt(tree.id, 'Answer in French.')

    expect(changedTree.systemPrompt.text).toBe('Answer in French.')
    expect(published.at(-1)).toEqual({type: 'TREE_CHANGED', tree: changedTree})

    await sendPrompt(tree.id, first.reply.id)

    expect(sentSystemPrompts()).toEqual([
      expect.stringMatching(DEFAULT_PRESET),
      expect.stringMatching(/^Answer in French\.\n\n# Your files/),
    ])
    expect((await repliesOf(tree.id)).map(one => one.systemPromptId)).toEqual([
      tree.systemPrompt.id,
      changedTree.systemPrompt.id,
    ])
    expect(changedTree.systemPrompt.id).not.toBe(tree.systemPrompt.id)
  })

  it('keeps one record of the same text, which Trees and Replies under it share', async () => {
    const tree = await createTree()
    const other = await createTree()
    const french = await setSystemPrompt(other.id, 'Answer in French.')
    const back = await setSystemPrompt(other.id, tree.systemPrompt.text)
    const {reply} = await sendPrompt(tree.id, null)

    expect(french.systemPrompt.id).not.toBe(tree.systemPrompt.id)
    expect(back.systemPrompt).toEqual(tree.systemPrompt)
    expect(reply.systemPromptId).toBe(tree.systemPrompt.id)
  })

  it('retries a Reply under the System prompt it first ran under', async () => {
    const tree = await createTree()
    const {reply} = await sendPrompt(tree.id, null)
    deps.turns.hostEvent('claude', {
      type: 'RUN_FINISHED',
      treeId: tree.id,
      replyId: reply.id,
      status: 'failed',
      failure: {code: 'host-crashed', message: 'Claude stopped unexpectedly.'},
    })
    await setSystemPrompt(tree.id, 'Answer in French.')

    await send({type: 'reply.retry', treeId: tree.id, replyId: reply.id})

    expect(sentSystemPrompts()).toEqual([
      expect.stringMatching(DEFAULT_PRESET),
      expect.stringMatching(DEFAULT_PRESET),
    ])
    expect((await repliesOf(tree.id))[0]?.systemPromptId).toBe(
      tree.systemPrompt.id
    )
  })

  it('answers not-found for changing a Tree that does not exist', async () => {
    expect(
      await send({
        type: 'tree.set-system-prompt',
        treeId: crypto.randomUUID(),
        text: '',
      })
    ).toMatchObject({ok: false, error: {code: 'not-found'}})
  })
})

async function setTools(treeId: string, changes: Partial<TreeTools>) {
  const outcome = await send({type: 'tree.set-tools', treeId, changes})

  if (!outcome.ok) throw new Error(outcome.error.message)

  return TreeSchema.parse(outcome.value)
}

function sentTools() {
  return hostCommands.flatMap(command =>
    command.type === 'reply.start' ? [command.request.tools] : []
  )
}

describe('the Tools panel', () => {
  it('gives a new Tree a copy of the Tools defaults, which no later change to the defaults touches', async () => {
    const before = await createTree()

    const defaults = {
      ...DEFAULT_TREE_TOOLS,
      webSearch: false,
      chatgptRemotePlugins: true,
    }

    await send({type: 'settings.update', changes: {toolDefaults: defaults}})

    clock = new Date('2026-10-20T12:00:00.000Z')

    const after = await createTree()

    expect(before.tools).toEqual(DEFAULT_TREE_TOOLS)
    expect(after.tools).toEqual(defaults)
    expect(await listed()).toEqual([after, before])
  })

  it('changes only that Tree, tells every window, and sends the change with the Tree’s next Reply and a Retry', async () => {
    const tree = await createTree()
    const other = await createTree()
    const first = await sendPrompt(tree.id, null)
    answer(tree.id, first.reply.id)
    published = []

    const noSearch = await setTools(tree.id, {webSearch: false})
    const connectors = await setTools(tree.id, {claudeConnectors: true})

    expect(noSearch.tools).toEqual({...DEFAULT_TREE_TOOLS, webSearch: false})
    expect(connectors.tools).toEqual({
      ...DEFAULT_TREE_TOOLS,
      webSearch: false,
      claudeConnectors: true,
    })
    expect(changed()).toEqual([noSearch, connectors])

    const {reply} = await sendPrompt(tree.id, first.reply.id)
    deps.turns.hostEvent('claude', {
      type: 'RUN_FINISHED',
      treeId: tree.id,
      replyId: reply.id,
      status: 'failed',
      failure: {code: 'host-crashed', message: 'Claude stopped unexpectedly.'},
    })
    await send({type: 'reply.retry', treeId: tree.id, replyId: reply.id})
    await sendPrompt(other.id, null)

    expect(sentTools()).toEqual([
      DEFAULT_TREE_TOOLS,
      connectors.tools,
      connectors.tools,
      DEFAULT_TREE_TOOLS,
    ])
  })

  it('answers not-found for changing a Tree that does not exist', async () => {
    expect(
      await send({
        type: 'tree.set-tools',
        treeId: crypto.randomUUID(),
        changes: {webSearch: false},
      })
    ).toMatchObject({ok: false, error: {code: 'not-found'}})
  })
})

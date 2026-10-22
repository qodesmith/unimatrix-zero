import type {Command} from '@uz/contract/commands'
import type {AppEvent} from '@uz/contract/events'
import type {HostCommand} from '@uz/contract/host'

import {openDatabase} from '#modules/database/main'
import {createTrees} from '#modules/trees/main'
import {createTurns} from '#modules/turns/main'
import {PromptSendResult} from '@uz/contract/commands'
import {TreeSchema} from '@uz/contract/trees'
import path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'

import {dispatchCommand} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')
const trusted = {isTopLevelAppFrame: true}

let published: AppEvent[]
let hostCommands: HostCommand[]
let hostReady: boolean
let deps: Parameters<typeof dispatchCommand>[2]

beforeEach(() => {
  const db = openDatabase({file: ':memory:', migrationsFolder})
  published = []
  hostCommands = []
  hostReady = true

  function publish(event: AppEvent) {
    published.push(event)
  }

  deps = {
    now: () => new Date('2026-10-19T12:00:00.000Z'),
    trees: createTrees(db),
    turns: createTurns(db, publish),
    hosts: {
      ready: () =>
        hostReady
          ? {provider: 'claude', model: {id: 'fake', name: 'Fake model'}}
          : null,
      send: (_provider, command) => hostCommands.push(command),
    },
    publish,
  }
})

/** Commands, plus the malformed ones a hostile page could send. */
type Sent =
  | Command
  | {type: 'app.nope'}
  | {type: 'app.ping'; nonce: string; extra: true}

async function send(raw: Sent) {
  return dispatchCommand(raw, trusted, deps)
}

async function createTree() {
  const outcome = await send({type: 'tree.create'})

  if (!outcome.ok) throw new Error(outcome.error.message)

  return TreeSchema.parse(outcome.value)
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

  it('rejects a command type it does not know', async () => {
    const outcome = await send({type: 'app.nope'})
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
    deps.now = () => new Date('2026-10-20T12:00:00.000Z')
    const second = await createTree()

    expect(await send({type: 'tree.list'})).toEqual({
      ok: true,
      value: {trees: [second, first]},
    })
  })

  it('opens a Tree by id', async () => {
    const tree = await createTree()

    expect(await send({type: 'tree.open', treeId: tree.id})).toEqual({
      ok: true,
      value: tree,
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
    expect(published.at(-1)).toEqual({type: 'TREE_RENAMED', tree: renamed})
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

describe('the root Prompt', () => {
  it('saves the Prompt and a streaming Reply, and asks the host for it', async () => {
    const tree = await createTree()

    const outcome = await send({
      type: 'prompt.send',
      treeId: tree.id,
      text: ' Hello ',
    })

    if (!outcome.ok) throw new Error(outcome.error.message)

    const {prompt, reply} = PromptSendResult.parse(outcome.value)

    expect(prompt).toMatchObject({
      treeId: tree.id,
      parentReplyId: null,
      text: 'Hello',
    })
    expect(reply).toMatchObject({
      promptId: prompt.id,
      provider: 'claude',
      model: 'fake',
      status: 'streaming',
      content: [],
    })
    expect(hostCommands).toEqual([
      {
        type: 'reply.start',
        request: {
          treeId: tree.id,
          replyId: reply.id,
          model: 'fake',
          systemPrompt: '',
          prompt: {text: 'Hello'},
        },
      },
    ])
    expect(await send({type: 'tree.turns', treeId: tree.id})).toEqual({
      ok: true,
      value: {prompts: [prompt], replies: [reply]},
    })
  })

  it('is refused when no Provider is ready, and nothing is saved', async () => {
    const tree = await createTree()
    hostReady = false

    const outcome = await send({
      type: 'prompt.send',
      treeId: tree.id,
      text: 'Hi',
    })

    expect(outcome).toMatchObject({ok: false, error: {code: 'handler-failed'}})
    expect(await send({type: 'tree.turns', treeId: tree.id})).toEqual({
      ok: true,
      value: {prompts: [], replies: []},
    })
  })

  it('fails the Reply when the host cannot be reached', async () => {
    const tree = await createTree()

    deps.hosts = {
      ...deps.hosts,
      send: () => {
        throw new Error('The claude host is not running.')
      },
    }

    await send({type: 'prompt.send', treeId: tree.id, text: 'Hi'})

    expect(await send({type: 'tree.turns', treeId: tree.id})).toMatchObject({
      ok: true,
      value: {replies: [{status: 'failed'}]},
    })
    expect(published.at(-1)).toMatchObject({
      type: 'RUN_FINISHED',
      status: 'failed',
      failure: {code: 'host-unreachable'},
    })
  })

  it('is refused once the Tree has one', async () => {
    const tree = await createTree()
    await send({type: 'prompt.send', treeId: tree.id, text: 'Hi'})

    const outcome = await send({
      type: 'prompt.send',
      treeId: tree.id,
      text: 'Again',
    })

    expect(outcome).toMatchObject({
      ok: false,
      error: {message: 'This Tree already has its first Prompt.'},
    })
    expect(hostCommands).toHaveLength(1)
  })
})

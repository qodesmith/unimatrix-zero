import type {Database} from '#modules/database/main'
import type {AppEvent} from '@uz/contract/events'
import type {HostCommand} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {ReplyEvent} from '@uz/contract/turns'

import {openDatabase, schema} from '#modules/database/main'
import {createTrees} from '#modules/trees/main'
import {createTurns} from '#modules/turns/main'
import {DEFAULT_TREE_TOOLS} from '@uz/contract/tools'
import {eq} from 'drizzle-orm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, expect, inject, it} from 'vitest'

import {createTreeFiles} from './main'
import {removeFolder} from './test-cleanup'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

let db: Database
let userData: string
let published: AppEvent[]
let failures: unknown[]
let gitProgram: string | null
let waitedForGit: number
let hostCommands: HostCommand[]
let snapshots: Promise<void>[]
let treeFiles: ReturnType<typeof createTreeFiles>
let turns: ReturnType<typeof createTurns>
let treeId: string

function launch() {
  treeFiles = createTreeFiles({
    db,
    userData,
    publish: event => published.push(event),
    onFailure: error => failures.push(error),
    gitProgram: () => gitProgram,
    onWaitingForGit: () => {
      waitedForGit += 1
    },
  })

  turns = createTurns({
    db,
    publish: event => published.push(event),
    hosts: {
      ready: () => true,
      send: (_provider, command) => hostCommands.push(command),
    },
    vendorProgramFor: () => ({program: null, configDir: '/config'}),
    treeFolderFor: treeFiles.folderFor,
    snapshotsBefore: treeFiles.snapshotsBefore,
    compactionSettingsFor: () => ({auto: true, threshold: null}),
    permissionMode: () => 'full-access',
    sandboxFolders: {hiddenFolders: [], treesFolder: '/trees'},
    listedModels: () => [],
    attachmentsDir: path.join(userData, 'attachments'),
    now: () => new Date(),
    onTurnsChanged: () => undefined,
    onReplyFinished: finished =>
      snapshots.push(treeFiles.replyFinished(finished)),
  })

  snapshots.push(treeFiles.takeMissedSnapshots())
}

beforeEach(() => {
  db = openDatabase({file: ':memory:', migrationsFolder})
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-user-data-'))
  published = []
  failures = []
  gitProgram = inject('gitProgram')
  waitedForGit = 0
  hostCommands = []
  snapshots = []

  launch()

  treeId = createTrees(db).create(new Date(), '', DEFAULT_TREE_TOOLS).id
})

afterEach(() => {
  removeFolder(userData)
})

function send(parentReplyId: string | null, provider: ProviderId = 'claude') {
  const sent = turns.sendPrompt({
    model: {provider, model: 'fake'},
    treeId,
    parentReplyId,
    text: 'Hi',
  })

  if (!sent) throw new Error('The Reply it answers is gone')

  return sent.reply.id
}

function startOf(replyId: string) {
  const started = hostCommands.find(
    command =>
      command.type === 'reply.start' && command.request.replyId === replyId
  )

  return started?.type === 'reply.start' ? started : null
}

function folderOf(replyId: string) {
  const started = startOf(replyId)

  if (!started) throw new Error('It never started')

  return started.request.treeFolder
}

async function whenStarted(replyId: string) {
  await expect.poll(() => startOf(replyId)).not.toBeNull()
}

function aiWrites(replyId: string, name: string, text: string) {
  const file = path.join(folderOf(replyId), name)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, text)
}

type Without<T> = T extends unknown ? Omit<T, 'treeId' | 'replyId'> : never

function fromHost(
  replyId: string,
  event: Without<ReplyEvent>,
  provider: ProviderId = 'claude'
) {
  turns.hostEvent(provider, {...event, treeId, replyId})
}

async function finish(
  replyId: string,
  status: 'complete' | 'stopped' | 'failed' = 'complete',
  provider: ProviderId = 'claude'
) {
  fromHost(replyId, {type: 'RUN_FINISHED', status}, provider)
  await Promise.all(snapshots)
}

function filesChanged() {
  return published.filter(event => event.type === 'FILES_CHANGED')
}

function savedSnapshot(replyId: string) {
  return db
    .select({
      snapshotCommit: schema.replies.snapshotCommit,
      noSnapshot: schema.replies.noSnapshot,
    })
    .from(schema.replies)
    .where(eq(schema.replies.id, replyId))
    .get()
}

function snapshotOf(replyId: string) {
  return savedSnapshot(replyId)?.snapshotCommit
}

async function listed() {
  const {replies} = turns.list(treeId)
  const withFiles = await treeFiles.withChangedFiles(treeId, replies)

  return Object.fromEntries(withFiles.map(reply => [reply.id, reply.files]))
}

function inUserData() {
  return fs.readdirSync(userData).toSorted()
}

it('leaves a Tree whose AI never writes with an empty folder and nothing else', async () => {
  const replyId = send(null)
  const folder = folderOf(replyId)

  await finish(replyId)

  expect(fs.readdirSync(folder)).toEqual([])
  expect(inUserData()).toEqual(['trees'])
  expect(snapshotOf(replyId)).toBeNull()
  expect(filesChanged()).toEqual([])
  expect(await listed()).toEqual({[replyId]: []})
  expect(failures).toEqual([])
})

it('makes the hidden store with the AI’s first write, outside the Tree’s folder, and says after the Reply ends which files it created', async () => {
  const quiet = send(null)
  await finish(quiet)

  const replyId = send(quiet)
  aiWrites(replyId, 'notes/plan.md', 'A plan')
  published = []
  await finish(replyId)

  expect(inUserData()).toEqual(['tree-stores', 'trees'])
  expect(fs.readdirSync(path.join(userData, 'tree-stores'))).toEqual([
    `${treeId}.git`,
  ])
  expect(fs.readdirSync(folderOf(replyId))).toEqual(['notes'])
  expect(snapshotOf(replyId)).toMatch(/^[0-9a-f]{40}$/)
  expect(published).toEqual([
    {type: 'RUN_FINISHED', treeId, replyId, status: 'complete'},
    {
      type: 'FILES_CHANGED',
      treeId,
      replyId,
      files: [{path: 'notes/plan.md', change: 'created', size: 6}],
    },
  ])
  expect(await listed()).toEqual({
    [quiet]: [],
    [replyId]: [{path: 'notes/plan.md', change: 'created', size: 6}],
  })
  expect(failures).toEqual([])
})

it('lists the files a Reply changed while its Snapshot is still being taken, the Tree’s first included', async () => {
  const first = send(null)
  aiWrites(first, 'a.txt', 'one')
  fromHost(first, {type: 'RUN_FINISHED', status: 'complete'})

  expect(await listed()).toEqual({
    [first]: [{path: 'a.txt', change: 'created', size: 3}],
  })

  const second = send(first)
  await whenStarted(second)
  aiWrites(second, 'b.txt', 'two')
  fromHost(second, {type: 'RUN_FINISHED', status: 'complete'})

  expect(await listed()).toEqual({
    [first]: [{path: 'a.txt', change: 'created', size: 3}],
    [second]: [{path: 'b.txt', change: 'created', size: 3}],
  })
})

it('gives a Reply that changed nothing its parent’s Snapshot and no files, and the next Reply only what it changed itself', async () => {
  const first = send(null)
  aiWrites(first, 'a.txt', 'one')
  aiWrites(first, 'b.txt', 'two')
  await finish(first)

  const second = send(first)
  await finish(second)

  const third = send(second)
  aiWrites(third, 'a.txt', 'one more')
  fs.rmSync(path.join(folderOf(third), 'b.txt'))
  published = []
  await finish(third, 'stopped')

  expect(snapshotOf(second)).toBe(snapshotOf(first))
  expect(snapshotOf(third)).not.toBe(snapshotOf(first))
  expect(filesChanged()).toEqual([
    {
      type: 'FILES_CHANGED',
      treeId,
      replyId: third,
      files: [
        {path: 'a.txt', change: 'edited', size: 8},
        {path: 'b.txt', change: 'deleted', size: null},
      ],
    },
  ])
  expect(await listed()).toEqual({
    [first]: [
      {path: 'a.txt', change: 'created', size: 3},
      {path: 'b.txt', change: 'created', size: 3},
    ],
    [second]: [],
    [third]: [
      {path: 'a.txt', change: 'edited', size: 8},
      {path: 'b.txt', change: 'deleted', size: null},
    ],
  })
})

it('takes a failed Reply’s Snapshot too, and its Retry’s in its place', async () => {
  const replyId = send(null)
  aiWrites(replyId, 'draft.md', 'half')
  await finish(replyId, 'failed')
  const failed = snapshotOf(replyId)

  turns.retry(treeId, replyId)
  const cleared = snapshotOf(replyId)
  aiWrites(replyId, 'draft.md', 'whole thing')
  await finish(replyId)

  expect(failed).toMatch(/^[0-9a-f]{40}$/)
  expect(cleared).toBeNull()
  expect(snapshotOf(replyId)).not.toBe(failed)
  expect(await listed()).toEqual({
    [replyId]: [{path: 'draft.md', change: 'created', size: 11}],
  })
})

it('starts the next Reply only once the Snapshot being taken is done, and takes that Snapshot once', async () => {
  const first = send(null)
  aiWrites(first, 'a.txt', 'one')
  fromHost(first, {type: 'RUN_FINISHED', status: 'complete'})
  hostCommands = []

  const second = send(first)

  expect(hostCommands).toEqual([])
  expect(snapshotOf(first)).toBeNull()

  await Promise.all(snapshots)
  await expect
    .poll(() => hostCommands)
    .toMatchObject([{type: 'reply.start', request: {replyId: second}}])
  expect(snapshotOf(first)).toMatch(/^[0-9a-f]{40}$/)
  expect(filesChanged()).toEqual([
    {
      type: 'FILES_CHANGED',
      treeId,
      replyId: first,
      files: [{path: 'a.txt', change: 'created', size: 3}],
    },
  ])
})

it('never starts a Reply that was stopped with every other in its Tree while the Snapshot was taken', async () => {
  const first = send(null)
  aiWrites(first, 'a.txt', 'one')
  fromHost(first, {type: 'RUN_FINISHED', status: 'complete'})

  send(first)
  turns.stopAll(treeId)
  hostCommands = []
  await Promise.all(snapshots)
  await new Promise(resolve => {
    setImmediate(resolve)
  })

  expect(hostCommands).toEqual([])
})

it.each(['claude', 'chatgpt'] as const)(
  'takes the Snapshot of a Reply written on %s from the folder its vendor program ran in',
  async provider => {
    const replyId = send(null, provider)

    aiWrites(replyId, 'notes.txt', 'HERON')
    await finish(replyId, 'complete', provider)

    expect(filesChanged()).toEqual([
      {
        type: 'FILES_CHANGED',
        treeId,
        replyId,
        files: [{path: 'notes.txt', change: 'created', size: 5}],
      },
    ])
    expect(failures).toEqual([])
  }
)

it('reports a Snapshot it can’t take, leaves the Reply as it finished, and takes it before the next Reply starts', async () => {
  const replyId = send(null)
  const store = path.join(userData, 'tree-stores', `${treeId}.git`)
  aiWrites(replyId, 'a.txt', 'one')
  fs.mkdirSync(path.dirname(store))
  fs.writeFileSync(store, '')

  await finish(replyId)

  expect(failures).toHaveLength(1)
  expect(snapshotOf(replyId)).toBeNull()
  expect(turns.list(treeId).replies).toMatchObject([{status: 'complete'}])

  fs.rmSync(store)
  const next = send(replyId)
  await whenStarted(next)
  aiWrites(next, 'b.txt', 'two')
  await finish(next)

  expect(await listed()).toEqual({
    [replyId]: [{path: 'a.txt', change: 'created', size: 3}],
    [next]: [{path: 'b.txt', change: 'created', size: 3}],
  })
})

it('takes no Snapshot while the app’s git isn’t in place, leaves the Reply as it finished, reports no failure, and takes it before the next Reply once git is in place', async () => {
  const program = gitProgram
  gitProgram = null
  const replyId = send(null)
  aiWrites(replyId, 'a.txt', 'one')

  await finish(replyId)

  expect(savedSnapshot(replyId)).toEqual({
    snapshotCommit: null,
    noSnapshot: 'failed',
  })
  expect(turns.list(treeId).replies).toMatchObject([{status: 'complete'}])
  expect(waitedForGit).toBe(1)
  expect(failures).toEqual([])

  gitProgram = program
  const next = send(replyId)
  await whenStarted(next)
  aiWrites(next, 'b.txt', 'two')
  await finish(next)

  expect(await listed()).toEqual({
    [replyId]: [{path: 'a.txt', change: 'created', size: 3}],
    [next]: [{path: 'b.txt', change: 'created', size: 3}],
  })
})

it('fails the Snapshot, not the Reply, when the app’s git is gone from its path', async () => {
  gitProgram = path.join(userData, 'vendor', 'git', 'gone', 'git')
  const replyId = send(null)
  aiWrites(replyId, 'a.txt', 'one')

  await finish(replyId)

  expect(failures).toMatchObject([{code: 'ENOENT'}])
  expect(savedSnapshot(replyId)?.noSnapshot).toBe('failed')
  expect(turns.list(treeId).replies).toMatchObject([{status: 'complete'}])
})

it('takes the Snapshot of a Reply the app quit on before the next Reply starts, and says which files it changed', async () => {
  const quit = send(null)
  aiWrites(quit, 'a.txt', 'one')

  launch()
  const next = send(quit)
  await whenStarted(next)
  aiWrites(next, 'b.txt', 'two')
  await finish(next)

  expect(filesChanged()).toEqual([
    {
      type: 'FILES_CHANGED',
      treeId,
      replyId: quit,
      files: [{path: 'a.txt', change: 'created', size: 3}],
    },
    {
      type: 'FILES_CHANGED',
      treeId,
      replyId: next,
      files: [{path: 'b.txt', change: 'created', size: 3}],
    },
  ])
  expect(await listed()).toEqual({
    [quit]: [{path: 'a.txt', change: 'created', size: 3}],
    [next]: [{path: 'b.txt', change: 'created', size: 3}],
  })
})

it('takes the Snapshot of a Reply the app quit on when it starts again, so a Reply on another Branch adds no files to it', async () => {
  const root = send(null)
  await finish(root)

  const quit = send(root)
  await whenStarted(quit)
  aiWrites(quit, 'a.txt', 'one')

  launch()
  const other = send(root)
  await whenStarted(other)
  aiWrites(other, 'b.txt', 'two')
  await finish(other)

  expect(await listed()).toMatchObject({
    [quit]: [{path: 'a.txt', change: 'created', size: 3}],
  })
})

it('never gives a Reply that ended while the Tree had no files the files a later Reply wrote', async () => {
  const quiet = send(null)
  await finish(quiet)

  const writer = send(quiet)
  aiWrites(writer, 'a.txt', 'one')
  await finish(writer)

  const fork = send(quiet)
  await whenStarted(fork)
  await finish(fork)

  expect(await listed()).toMatchObject({[quiet]: []})
})

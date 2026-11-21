import type {Database} from '#modules/database/main'
import type {AppEvent} from '@uz/contract/events'
import type {HostCommand} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'
import type {ReplyEvent} from '@uz/contract/turns'

import {openDatabase, schema} from '#modules/database/main'
import {createTrees} from '#modules/trees/main'
import {createTurns} from '#modules/turns/main'
import {eq} from 'drizzle-orm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, expect, it} from 'vitest'

import {createTreeFiles} from './main'
import {removeFolder} from './test-cleanup'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

let db: Database
let userData: string
let published: AppEvent[]
let failures: unknown[]
let hostCommands: HostCommand[]
let snapshots: Promise<void>[]
let treeFiles: ReturnType<typeof createTreeFiles>
let turns: ReturnType<typeof createTurns>
let treeId: string

beforeEach(() => {
  db = openDatabase({file: ':memory:', migrationsFolder})
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-user-data-'))
  published = []
  failures = []
  hostCommands = []
  snapshots = []

  treeFiles = createTreeFiles({
    db,
    userData,
    publish: event => published.push(event),
    onFailure: error => failures.push(error),
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
    snapshotting: treeFiles.snapshotting,
    compactionSettingsFor: () => ({auto: true, threshold: null}),
    listedModels: () => [],
    attachmentsDir: path.join(userData, 'attachments'),
    now: () => new Date(),
    onTurnsChanged: () => undefined,
    onReplyFinished: finished =>
      snapshots.push(treeFiles.replyFinished(finished)),
  })

  treeId = createTrees(db).create(new Date()).id
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

/** The folder the host was told to run the Reply's vendor program in. */
function folderOf(replyId: string) {
  const started = hostCommands.find(
    command =>
      command.type === 'reply.start' && command.request.replyId === replyId
  )

  if (started?.type !== 'reply.start') throw new Error('It never started')

  return started.request.treeFolder
}

/** What the AI does on disk while it writes the Reply. */
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

function snapshotOf(replyId: string) {
  return db
    .select({snapshotCommit: schema.replies.snapshotCommit})
    .from(schema.replies)
    .where(eq(schema.replies.id, replyId))
    .get()?.snapshotCommit
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

it('starts the next Reply only once the Snapshot being taken is done', async () => {
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

it('reports a Snapshot it can’t take and leaves the Reply as it finished', async () => {
  const replyId = send(null)
  aiWrites(replyId, 'a.txt', 'one')
  fs.mkdirSync(path.join(userData, 'tree-stores'))
  fs.writeFileSync(path.join(userData, 'tree-stores', `${treeId}.git`), '')

  await finish(replyId)

  expect(failures).toHaveLength(1)
  expect(snapshotOf(replyId)).toBeNull()
  expect(turns.list(treeId).replies).toMatchObject([{status: 'complete'}])
})

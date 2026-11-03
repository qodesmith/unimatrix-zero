import type {Trees} from '#modules/trees/main'
import type {Turns} from '#modules/turns/main'
import type {AppEvent} from '@uz/contract/events'
import type {SignInRequest} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'

import {openDatabase} from '#modules/database/main'
import {createTrees} from '#modules/trees/main'
import {createTurns} from '#modules/turns/main'
import path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'

import {createTitles} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

const vendorProgram = {program: null, configDir: '/claude'}

interface OneShot {
  provider: ProviderId
  request: {prompt: string; vendorProgram: SignInRequest}
  resolve: (text: string) => void
  reject: (error: Error) => void
}

let published: AppEvent[]
let oneShots: OneShot[]
let pending: Promise<void>[]
let trees: Trees
let turns: Turns
let treeId: string

beforeEach(() => {
  const db = openDatabase({file: ':memory:', migrationsFolder})
  published = []
  oneShots = []
  pending = []
  trees = createTrees(db)

  const titles = createTitles({
    trees,
    turnsOf: id => turns.list(id),
    runOneShot: async (provider, request) =>
      new Promise((resolve, reject) => {
        oneShots.push({provider, request, resolve, reject})
      }),
    vendorProgramFor: () => vendorProgram,
    publish: event => published.push(event),
  })

  turns = createTurns({
    db,
    publish: () => undefined,
    hosts: {
      ready: () => true,
      send: () => undefined,
    },
    vendorProgramFor: () => vendorProgram,
    now: () => new Date('2026-10-19T12:00:00.000Z'),
    onTurnsChanged: () => undefined,
    onReplyFinished: finished => pending.push(titles.replyFinished(finished)),
  })

  treeId = trees.create(new Date('2026-10-19T12:00:00.000Z')).id
})

function sendPrompt(parentReplyId: string | null, text = 'Hi') {
  const sent = turns.sendPrompt({
    treeId,
    parentReplyId,
    text,
    model: {provider: 'claude', model: 'fake'},
  })

  if (!sent) throw new Error('The Reply it answers is gone')

  return sent.reply.id
}

function finish(
  replyId: string,
  status: 'complete' | 'stopped' | 'failed' = 'complete',
  text = 'Lisbon in May is mild.'
) {
  turns.hostEvent('claude', {type: 'TEXT_DELTA', treeId, replyId, delta: text})
  turns.hostRecorded('claude', {
    type: 'REPLY_RECORDED',
    treeId,
    replyId,
    model: 'fake',
    session: {sessionId: 's1', messageId: replyId},
  })
  turns.hostEvent('claude', {
    type: 'RUN_FINISHED',
    treeId,
    replyId,
    status,
    ...(status === 'failed'
      ? {failure: {code: 'provider-error', message: 'Overloaded.'}}
      : {}),
  })
}

function lastOneShot() {
  const oneShot = oneShots.at(-1)

  if (!oneShot) throw new Error('No one-shot was run')

  return oneShot
}

async function settled() {
  await Promise.all(pending)
}

function title() {
  return trees.get(treeId)?.title
}

describe('the automatic title', () => {
  it('is written once the first Reply finishes, from a one-shot on its Provider about the root Prompt and the Reply', async () => {
    finish(sendPrompt(null, 'Plan a trip to Lisbon'))

    expect(oneShots).toHaveLength(1)
    expect(lastOneShot()).toMatchObject({
      provider: 'claude',
      request: {vendorProgram},
    })
    expect(lastOneShot().request.prompt).toContain('Plan a trip to Lisbon')
    expect(lastOneShot().request.prompt).toContain('Lisbon in May is mild.')

    lastOneShot().resolve('Trip to Lisbon')
    await settled()

    expect(title()).toBe('Trip to Lisbon')
    expect(published).toEqual([{type: 'TREE_CHANGED', tree: trees.get(treeId)}])
  })

  it('asks about no more than the start of a long Prompt and Reply', () => {
    finish(
      sendPrompt(null, `${'p'.repeat(5000)}PROMPT-END`),
      'complete',
      `${'r'.repeat(5000)}REPLY-END`
    )

    expect(lastOneShot().request.prompt).not.toContain('PROMPT-END')
    expect(lastOneShot().request.prompt).not.toContain('REPLY-END')
    expect(lastOneShot().request.prompt.length).toBeLessThan(5000)
  })

  it.each([
    ['"Trip to Lisbon."', 'Trip to Lisbon'],
    ['\n\n  **Trip to Lisbon**  \nA plan for May', 'Trip to Lisbon'],
    ['# “Trip to Lisbon”', 'Trip to Lisbon'],
    ['`Trip to Lisbon`', 'Trip to Lisbon'],
    ['x'.repeat(250), 'x'.repeat(200)],
  ])('cleans the answer %j to %j', async (answer, cleaned) => {
    finish(sendPrompt(null))
    lastOneShot().resolve(answer)
    await settled()

    expect(title()).toBe(cleaned)
  })

  it.each([['   \n  '], ['""']])(
    'writes nothing for an empty answer %j',
    async answer => {
      finish(sendPrompt(null))
      lastOneShot().resolve(answer)
      await settled()

      expect(title()).toBeNull()
      expect(published).toEqual([])
    }
  )

  it('keeps a title the user gave while the one-shot ran', async () => {
    finish(sendPrompt(null))
    trees.rename(treeId, 'My trip')
    lastOneShot().resolve('Trip to Lisbon')
    await settled()

    expect(title()).toBe('My trip')
    expect(published).toEqual([])
  })

  it('is not asked for once the user has named the Tree', () => {
    trees.rename(treeId, 'My trip')
    finish(sendPrompt(null))

    expect(oneShots).toEqual([])
  })

  it('is never asked for again by a later Reply', async () => {
    const root = sendPrompt(null)
    finish(root)
    lastOneShot().reject(new Error('Rate limited.'))
    await settled()

    finish(sendPrompt(root))
    finish(sendPrompt(root))

    expect(oneShots).toHaveLength(1)
  })

  it('leaves the Tree untitled when the one-shot fails, and doesn’t ask again', async () => {
    finish(sendPrompt(null))
    lastOneShot().reject(new Error('Rate limited.'))
    await settled()

    expect(title()).toBeNull()
    expect(published).toEqual([])
    expect(oneShots).toHaveLength(1)
  })

  it('is written when the first Reply was stopped', async () => {
    finish(sendPrompt(null), 'stopped')
    lastOneShot().resolve('Trip to Lisbon')
    await settled()

    expect(title()).toBe('Trip to Lisbon')
  })

  it('waits for a failed first Reply to be retried and finish', async () => {
    const root = sendPrompt(null)
    finish(root, 'failed')

    expect(oneShots).toEqual([])

    turns.retry(treeId, root)
    finish(root)
    lastOneShot().resolve('Trip to Lisbon')
    await settled()

    expect(title()).toBe('Trip to Lisbon')
  })
})

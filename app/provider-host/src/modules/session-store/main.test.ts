import type {HostMessage, SessionStoreRequest} from '@uz/contract/host'

import {expect, it} from 'vitest'
import {z} from 'zod'

import {createSessionStoreClient} from './main'

const folder = {projectKey: 'p', sessionId: 's'}

function setUp() {
  const sent: HostMessage[] = []
  const client = createSessionStoreClient(message => sent.push(message))

  function asked() {
    return sent.flatMap(message =>
      message.type === 'SESSION_STORE' ? [message] : []
    )
  }

  return {client, asked}
}

it('asks main for each operation, each under its own request id', () => {
  const {client, asked} = setUp()
  const key = {...folder, subpath: 'subagents/a'}
  const entries = [{type: 'user', uuid: 'a'}]
  const files = [{path: 'tool-results/1.txt', base64: 'aGk='}]

  void client.append(key, entries)
  void client.load(key)
  void client.listSubkeys(folder)
  void client.saveFiles(folder, files)
  void client.loadFiles(folder)

  expect(asked().map(({request}) => request)).toEqual([
    {
      op: 'append',
      key: {projectKey: 'p', sessionId: 's', subpath: 'subagents/a'},
      entries: [{type: 'user', uuid: 'a'}],
    },
    {
      op: 'load',
      key: {projectKey: 'p', sessionId: 's', subpath: 'subagents/a'},
    },
    {op: 'list-subkeys', projectKey: 'p', sessionId: 's'},
    {
      op: 'save-files',
      projectKey: 'p',
      sessionId: 's',
      files: [{path: 'tool-results/1.txt', base64: 'aGk='}],
    },
    {op: 'load-files', projectKey: 'p', sessionId: 's'},
  ] satisfies SessionStoreRequest[])
  expect(new Set(asked().map(({requestId}) => requestId)).size).toBe(5)
})

it('answers each request with main’s value for it, in any order', async () => {
  const {client, asked} = setUp()
  const first = client.listSubkeys(folder)
  const second = client.listSubkeys({...folder, sessionId: 't'})
  const [one, two] = asked()

  if (!one || !two) throw new Error('Nothing was asked')

  client.settle(two.requestId, {ok: true, value: ['b']})
  client.settle(one.requestId, {ok: true, value: ['a']})

  await expect(first).resolves.toEqual(['a'])
  await expect(second).resolves.toEqual(['b'])
})

it('rejects a request with main’s reason when main couldn’t answer', async () => {
  const {client, asked} = setUp()
  const saved = client.saveFiles(folder, [])
  const [one] = asked()

  if (!one) throw new Error('Nothing was asked')

  client.settle(one.requestId, {ok: false, message: 'The disk is full.'})

  await expect(saved).rejects.toThrow('The disk is full.')
})

it('rejects an answer that isn’t what the operation gives back', async () => {
  const {client, asked} = setUp()
  const listed = client.listSubkeys(folder)
  const [one] = asked()

  if (!one) throw new Error('Nothing was asked')

  client.settle(one.requestId, {ok: true, value: null})

  await expect(listed).rejects.toThrow(z.ZodError)
})

it('ignores an answer to a request it isn’t waiting for', () => {
  const {client} = setUp()

  expect(() => {
    client.settle('unknown', {ok: true, value: null})
  }).not.toThrow()
})

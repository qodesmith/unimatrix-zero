import type {ModelInfo} from '@anthropic-ai/claude-agent-sdk'
import type {SignInRequest} from '@uz/contract/host'
import type {Model} from '@uz/contract/providers'

import {expect, it} from 'vitest'

import {createModelList} from './models'

const opus: ModelInfo = {
  value: 'opus',
  displayName: 'Opus',
  description: 'The largest',
  resolvedModel: 'claude-opus-5-5',
}

const haiku: ModelInfo = {
  value: 'haiku',
  displayName: 'Haiku',
  description: 'The smallest',
}

const vendorProgram: SignInRequest = {program: null, configDir: '/claude'}

/** A reader that answers each read only when the test says. */
function heldReads() {
  const reads: {
    asked: SignInRequest
    answer: PromiseWithResolvers<ModelInfo[]>
  }[] = []

  async function read(asked: SignInRequest) {
    const answer = Promise.withResolvers<ModelInfo[]>()
    reads.push({asked, answer})

    return answer.promise
  }

  return {read, reads}
}

async function noRead(): Promise<never> {
  throw new Error('No read was expected')
}

it('tells a list once, and again only when a later `claude` lists other Models', () => {
  const list = createModelList(noRead)
  const changes: Model[][] = []
  list.onChanged(models => changes.push(models))

  list.learn([opus])
  list.learn([opus])
  list.learn([opus, haiku])

  expect(changes.map(models => models.map(model => model.id))).toEqual([
    ['opus'],
    ['opus', 'haiku'],
  ])
  expect(changes[1]?.[1]).toEqual({
    id: 'haiku',
    name: 'Haiku',
    isDefault: false,
    resolvesTo: null,
    needsAppUpdate: false,
  })
})

it('marks the SDK’s `default` entry as the default Model', () => {
  const list = createModelList(noRead)
  const changes: Model[][] = []
  list.onChanged(models => changes.push(models))

  list.learn([
    {value: 'default', displayName: 'Default', description: ''},
    opus,
  ])

  expect(changes[0]?.map(model => model.isDefault)).toEqual([true, false])
})

it('lists the Models it holds without reading them again', async () => {
  const list = createModelList(noRead)
  list.learn([opus])

  const listed = await list.list(vendorProgram)

  expect(listed.map(model => model.id)).toEqual(['opus'])
})

it('reads the Models once for every list asked while it holds none, and tells the list it read', async () => {
  const {read, reads} = heldReads()
  const list = createModelList(read)
  const changes: Model[][] = []
  list.onChanged(models => changes.push(models))

  const first = list.list(vendorProgram)
  const second = list.list(vendorProgram)

  for (const {answer} of reads) answer.resolve([opus, haiku])
  const listed = await Promise.all([first, second])

  expect(reads.map(({asked}) => asked)).toEqual([vendorProgram])
  expect(listed.map(models => models.map(model => model.id))).toEqual([
    ['opus', 'haiku'],
    ['opus', 'haiku'],
  ])
  expect(changes).toEqual([listed[0]])
})

it('fails a list whose read fails or reads no Models it can parse, and reads again for the next', async () => {
  const {read, reads} = heldReads()
  const list = createModelList(read)

  const failed = list.list(vendorProgram)
  reads[0]?.answer.reject(new Error('claude would not start'))

  await expect(failed).rejects.toThrow('claude would not start')

  const unparsed = list.list(vendorProgram)
  reads[1]?.answer.resolve([{...haiku, value: ''}])

  await expect(unparsed).rejects.toThrow(
    'Claude listed no Models the app can read.'
  )

  const listed = list.list(vendorProgram)
  reads[2]?.answer.resolve([haiku])

  await expect(listed).resolves.toEqual([
    expect.objectContaining({id: 'haiku'}),
  ])
})

it('resolves a name to the Model it stands for, and a name with none to itself', () => {
  const list = createModelList(noRead)

  expect(list.resolve('opus')).toBe('opus')

  list.learn([opus, haiku])

  expect([
    list.resolve('opus'),
    list.resolve('haiku'),
    list.resolve('sonnet'),
  ]).toEqual(['claude-opus-5-5', 'haiku', 'sonnet'])
})

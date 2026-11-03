import type {ModelInfo} from '@anthropic-ai/claude-agent-sdk'
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

it('tells a list once, and again only when a later `claude` lists other Models', () => {
  const list = createModelList()
  const changes: Model[][] = []
  list.onChanged(models => changes.push(models))

  list.learn([opus])
  list.learn([opus])
  list.learn([opus, haiku])

  expect(changes.map(models => models.map(model => model.id))).toEqual([
    ['opus'],
    ['opus', 'haiku'],
  ])
  expect(list.list()?.[1]).toEqual({
    id: 'haiku',
    name: 'Haiku',
    isDefault: false,
    resolvesTo: null,
    needsAppUpdate: false,
  })
})

it('resolves a name to the Model it stands for, and a name with none to itself', () => {
  const list = createModelList()

  expect(list.resolve('opus')).toBe('opus')

  list.learn([opus, haiku])

  expect([
    list.resolve('opus'),
    list.resolve('haiku'),
    list.resolve('sonnet'),
  ]).toEqual(['claude-opus-5-5', 'haiku', 'sonnet'])
})

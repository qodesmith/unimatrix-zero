import {expect, it} from 'vitest'

import {applyEvent} from './apply-event'

const older = {
  id: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  title: 'Older',
  createdAt: '2026-10-19T12:00:00.000Z',
}

const newer = {
  id: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
  title: null,
  createdAt: '2026-10-20T12:00:00.000Z',
}

it('puts a created Tree first', () => {
  expect(applyEvent([older], {type: 'TREE_CREATED', tree: newer})).toEqual([
    newer,
    older,
  ])
})

it('ignores a created Tree the list already has', () => {
  expect(
    applyEvent([newer, older], {type: 'TREE_CREATED', tree: newer})
  ).toEqual([newer, older])
})

it('renames a Tree in place', () => {
  const renamed = {...older, title: 'Renamed'}

  expect(
    applyEvent([newer, older], {type: 'TREE_RENAMED', tree: renamed})
  ).toEqual([newer, renamed])
})

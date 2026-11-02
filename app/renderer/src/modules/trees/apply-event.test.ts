import type {Tree} from '@uz/contract/trees'

import {expect, it} from 'vitest'

import {applyEvent} from './apply-event'

function tree(id: string, lastActiveAt: string): Tree {
  return {
    id,
    title: null,
    firstLine: null,
    createdAt: '2026-10-01T12:00:00.000Z',
    lastActiveAt,
    unseenFailure: false,
  }
}

const older = tree(
  '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  '2026-10-19T12:00:00.000Z'
)

const newer = tree(
  '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
  '2026-10-20T12:00:00.000Z'
)

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

it('changes a Tree in place', () => {
  const renamed = {...older, title: 'Renamed'}

  expect(
    applyEvent([newer, older], {type: 'TREE_CHANGED', tree: renamed})
  ).toEqual([newer, renamed])
})

it('moves a Tree up once it is the last active', () => {
  const sentTo = {...older, lastActiveAt: '2026-10-21T12:00:00.000Z'}

  expect(
    applyEvent([newer, older], {type: 'TREE_CHANGED', tree: sentTo})
  ).toEqual([sentTo, newer])
})

it('removes a deleted Tree', () => {
  expect(
    applyEvent([newer, older], {type: 'TREE_DELETED', treeId: newer.id})
  ).toEqual([older])
})

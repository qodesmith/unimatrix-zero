import type {Review} from './provider-checks-result.ts'
import type {Entry} from './provider-dependencies.ts'

import {isDeepStrictEqual} from 'node:util'

import {entriesOf} from './provider-dependencies.ts'

export function entriesToReview(scope: {
  pinMoved: boolean
  baseList: string
  headList: string
}) {
  const head = entriesOf(scope.headList)

  if (scope.pinMoved) return head

  const base = new Map(
    entriesOf(scope.baseList).map(entry => [entry.id, entry.fields])
  )

  return head.filter(
    entry => !isDeepStrictEqual(base.get(entry.id), entry.fields)
  )
}

export function reviewsOf(entries: Entry[], reviewed: Review[]): Review[] {
  return entries.map(
    entry =>
      reviewed.find(review => review.id === entry.id) ?? {
        id: entry.id,
        verdict: 'not needed',
        reason: 'no pin moved',
      }
  )
}

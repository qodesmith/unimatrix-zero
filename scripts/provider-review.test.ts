import type {Review} from './provider-checks-result.ts'

import {describe, expect, it} from 'vitest'

import {retriedOnce} from './provider-review.ts'

const ID = 'claude-auth-login-output'

function attempts(...outcomes: Omit<Review, 'id'>[]) {
  const queue = [...outcomes]
  let calls = 0

  return {
    calls: () => calls,
    next: async (): Promise<Review> => {
      calls++
      const outcome = queue.shift()

      if (!outcome) throw new Error('no attempt left')

      return {id: ID, ...outcome}
    },
  }
}

describe('a review that ends without a verdict', () => {
  it('runs once more, and gives the second try’s verdict', async () => {
    const tries = attempts(
      {verdict: 'not reviewed', reason: 'ran past 15 minutes'},
      {verdict: 'holds', reason: 'The login still prints its URL.'}
    )

    expect(await retriedOnce(tries.next)).toEqual({
      id: ID,
      verdict: 'holds',
      reason: 'The login still prints its URL.',
    })
  })

  it('is not reviewed when both tries end without one, naming both reasons', async () => {
    const twiceTimedOut = attempts(
      {verdict: 'not reviewed', reason: 'ran past 15 minutes'},
      {verdict: 'not reviewed', reason: 'ran past 15 minutes'}
    )

    const thenUnparsed = attempts(
      {verdict: 'not reviewed', reason: 'ran past 15 minutes'},
      {verdict: 'not reviewed', reason: 'error_max_turns'}
    )

    expect(await retriedOnce(twiceTimedOut.next)).toEqual({
      id: ID,
      verdict: 'not reviewed',
      reason: 'tried twice: ran past 15 minutes',
    })
    expect(await retriedOnce(thenUnparsed.next)).toEqual({
      id: ID,
      verdict: 'not reviewed',
      reason: 'tried twice: ran past 15 minutes, then error_max_turns',
    })
  })
})

describe('a review that gives a verdict', () => {
  it.each([
    {verdict: 'holds', reason: 'The login still prints its URL.'},
    {
      verdict: 'stale',
      reason: 'stale on the Provider side: the login prints no URL.',
    },
  ] as const)(
    'keeps a $verdict verdict without a second try',
    async verdict => {
      const tries = attempts(verdict, {
        verdict: 'holds',
        reason: 'a second try',
      })

      expect(await retriedOnce(tries.next)).toEqual({id: ID, ...verdict})
      expect(tries.calls()).toBe(1)
    }
  )
})

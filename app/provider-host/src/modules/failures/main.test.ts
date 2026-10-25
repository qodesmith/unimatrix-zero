import {expect, it} from 'vitest'

import {failureOf} from './main'

it.each([
  ['fetch failed', 'connection-lost'],
  ['Error: connect ECONNREFUSED 127.0.0.1:443', 'connection-lost'],
  ['stream disconnected before completion', 'connection-lost'],
  ['429 Too Many Requests', 'limit-reached'],
  ['You’ve hit your limit', 'limit-reached'],
  ['ENOSPC: no space left on device, write', 'disk-full'],
  ['Prompt is too long', 'provider-error'],
])('names the failure in %j as %s', (message, code) => {
  expect(failureOf(message)).toEqual({code, message})
})

it('keeps when a limit lifts, when the Provider said', () => {
  expect(
    failureOf('Usage limit reached. Resets at 2026-10-24T15:00:00Z.')
  ).toEqual({
    code: 'limit-reached',
    message: 'Usage limit reached. Resets at 2026-10-24T15:00:00Z.',
    resetsAt: '2026-10-24T15:00:00.000Z',
  })
  expect(failureOf('Rate limit reached, resets 1793970000')).toMatchObject({
    resetsAt: '2026-11-06T13:00:00.000Z',
  })
  expect(failureOf('Rate limit reached. Resets in a while.')).toEqual({
    code: 'limit-reached',
    message: 'Rate limit reached. Resets in a while.',
  })
})

it('takes when a limit lifts from the Provider over the message', () => {
  expect(
    failureOf('You’ve hit your limit · resets 3pm (Europe/London)', 1793970000)
  ).toEqual({
    code: 'limit-reached',
    message: 'You’ve hit your limit · resets 3pm (Europe/London)',
    resetsAt: '2026-11-06T13:00:00.000Z',
  })
  expect(failureOf('fetch failed', 1793970000)).toEqual({
    code: 'connection-lost',
    message: 'fetch failed',
  })
})

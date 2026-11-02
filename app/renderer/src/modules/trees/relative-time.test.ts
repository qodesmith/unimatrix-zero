import {expect, it} from 'vitest'

import {relativeTime} from './relative-time'

const now = Date.parse('2026-11-01T12:00:00.000Z')

function ago(ms: number) {
  return new Date(now - ms).toISOString()
}

const second = 1000
const minute = 60 * second
const hour = 60 * minute
const day = 24 * hour

it.each([
  [0, 'now'],
  [59 * second, 'now'],
  [minute, '1m'],
  [59 * minute + 59 * second, '59m'],
  [hour, '1h'],
  [23 * hour, '23h'],
  [day, '1d'],
  [6 * day, '6d'],
  [7 * day, '1w'],
  [29 * day, '4w'],
  [30 * day, '1mo'],
  [364 * day, '12mo'],
  [365 * day, '1y'],
  [800 * day, '2y'],
])('says %ims ago is %s', (elapsed, expected) => {
  expect(relativeTime(ago(elapsed), now)).toBe(expected)
})

it('says now for a time a little ahead of this clock', () => {
  expect(relativeTime(ago(-5 * second), now)).toBe('now')
})

import {afterEach, beforeEach, expect, it, vi} from 'vitest'

import {createWarmSessions} from './warm'

function session(sessionId: string, messageId: string) {
  return {
    sessionId,
    messageId,
    closed: false,
    async close() {
      this.closed = true
    },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

it('gives back the idle session standing at that Reply', () => {
  const warm = createWarmSessions({idleMs: 1000, max: 6})
  const one = session('s1', 'm1')
  warm.add(one)
  warm.release(one)

  expect(warm.claim({sessionId: 's1', messageId: 'm1'})).toBe(one)
  expect(warm.claim({sessionId: 's1', messageId: 'm1'})).toBeNull()
})

it('closes one standing elsewhere in the session instead of giving it back', () => {
  const warm = createWarmSessions({idleMs: 1000, max: 6})
  const one = session('s1', 'm2')
  warm.add(one)
  warm.release(one)

  expect(warm.claim({sessionId: 's1', messageId: 'm1'})).toBeNull()
  expect(one.closed).toBe(true)
  expect(warm.size).toBe(0)
})

it('closes a session once it has been idle long enough, not before', () => {
  const warm = createWarmSessions({idleMs: 1000, max: 6})
  const one = session('s1', 'm1')
  warm.add(one)
  warm.release(one)

  vi.advanceTimersByTime(999)
  expect(one.closed).toBe(false)

  vi.advanceTimersByTime(1)
  expect(one.closed).toBe(true)
})

it('starts the idle wait over after each Reply', () => {
  const warm = createWarmSessions({idleMs: 1000, max: 6})
  const one = session('s1', 'm1')
  warm.add(one)
  warm.release(one)
  vi.advanceTimersByTime(900)

  warm.claim({sessionId: 's1', messageId: 'm1'})
  vi.advanceTimersByTime(5000)
  expect(one.closed).toBe(false)

  warm.release(one)
  vi.advanceTimersByTime(1000)
  expect(one.closed).toBe(true)
})

it('closes the longest idle when more than the most are open', () => {
  const warm = createWarmSessions({idleMs: 1000, max: 2})
  const one = session('s1', 'm')
  const two = session('s2', 'm')
  const three = session('s3', 'm')

  for (const each of [one, two]) {
    warm.add(each)
    warm.release(each)
  }

  warm.add(three)

  expect([one.closed, two.closed, three.closed]).toEqual([true, false, false])
  expect(warm.size).toBe(2)
})

it('never closes a session writing a Reply to make room', () => {
  const warm = createWarmSessions({idleMs: 1000, max: 1})
  const one = session('s1', 'm')
  const two = session('s2', 'm')

  warm.add(one)
  warm.add(two)

  expect([one.closed, two.closed]).toEqual([false, false])

  warm.release(one)

  expect(one.closed).toBe(true)
  expect(warm.size).toBe(1)
})

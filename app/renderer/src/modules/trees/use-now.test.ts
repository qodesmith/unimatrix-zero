import {afterEach, expect, it, vi} from 'vitest'
import {renderHook} from 'vitest-browser-react'

import {useNow} from './use-now'

afterEach(() => {
  vi.useRealTimers()
})

it('moves on while mounted, so a relative time stays fresh', async () => {
  vi.useFakeTimers({toFake: ['Date', 'setInterval', 'clearInterval']})
  vi.setSystemTime(Date.parse('2026-11-01T12:00:00.000Z'))
  const {result, act, unmount} = await renderHook(() => useNow())
  expect(result.current).toBe(Date.parse('2026-11-01T12:00:00.000Z'))

  await act(() => {
    vi.advanceTimersByTime(60_000)
  })

  expect(result.current).toBe(Date.parse('2026-11-01T12:01:00.000Z'))

  await unmount()

  expect(vi.getTimerCount()).toBe(0)
})

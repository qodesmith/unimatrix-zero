import type {AppEvent} from '@uz/contract/events'

import {QueryClient} from '@tanstack/react-query'

import {applyLiveEvent, createReplyStore} from './live-replies'

/**
 * A live store for a test to replay events into, with a clock that starts at
 * 1000 and moves 100 ms per event, so thinking durations come out the same
 * every run.
 */
export function createReplay() {
  const store = createReplyStore()
  const queryClient = new QueryClient()
  let now = 1000

  function replay(events: AppEvent[]) {
    for (const event of events) {
      now += 100
      applyLiveEvent(event, store, queryClient, () => now)
    }
  }

  return {store, replay}
}

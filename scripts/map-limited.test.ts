import {describe, expect, it} from 'vitest'

import {mapLimited} from './map-limited.ts'

async function ticks(count: number) {
  for (let tick = 0; tick < count; tick++) await Promise.resolve()
}

describe('mapLimited', () => {
  it('runs at most the limit at once, and returns results in the items’ order though later items finish first', async () => {
    let running = 0
    let most = 0

    const results = await mapLimited([6, 5, 4, 3, 2, 1, 0], 3, async wait => {
      running++
      most = Math.max(most, running)
      await ticks(wait)
      running--

      return `waited ${wait}`
    })

    expect(most).toBe(3)
    expect(results).toEqual([
      'waited 6',
      'waited 5',
      'waited 4',
      'waited 3',
      'waited 2',
      'waited 1',
      'waited 0',
    ])
  })

  it('starts no more items once one throws, and throws only after the running ones settle', async () => {
    const started: number[] = []
    const settled: number[] = []

    const thrown = await mapLimited([50, 1, 0, 0], 2, async wait => {
      started.push(wait)
      await ticks(wait)

      if (wait === 1) throw new Error('the review threw')
      settled.push(wait)
    }).catch(error => ({error, settled: [...settled]}))

    expect(thrown).toEqual({
      error: new Error('the review threw'),
      settled: [50],
    })
    expect(started).toEqual([50, 1])
  })
})

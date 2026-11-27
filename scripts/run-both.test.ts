import {describe, expect, it} from 'vitest'

import {runBoth} from './run-both.ts'

async function outcomeOf(running: Promise<unknown>) {
  return running.then(() => 'resolved').catch((error: Error) => error)
}

async function stillPending(running: Promise<unknown>) {
  const timer = new Promise(resolve => {
    setTimeout(resolve, 0, 'pending')
  })

  return (await Promise.race([running, timer])) === 'pending'
}

describe('runBoth', () => {
  it('starts both before either settles, and returns both results in order', async () => {
    const live = Promise.withResolvers<string>()
    const started: string[] = []

    const both = runBoth(
      async () => {
        started.push('live checks')

        return live.promise
      },
      async () => {
        started.push('reviews')

        return 'reviewed'
      }
    )

    expect(started).toEqual(['live checks', 'reviews'])

    live.resolve('checked')

    expect(await both).toEqual(['checked', 'reviewed'])
  })

  it.each(['first', 'second'] as const)(
    'when the %s throws, waits for the other to settle, then throws its error',
    async side => {
      const other = Promise.withResolvers<string>()
      const thrown = new Error('vitest would not start')

      async function throwing() {
        throw thrown
      }

      async function running() {
        return other.promise
      }

      const both = outcomeOf(
        side === 'first'
          ? runBoth(throwing, running)
          : runBoth(running, throwing)
      )

      expect(await stillPending(both)).toBe(true)

      other.resolve('reviewed')

      expect(await both).toBe(thrown)
    }
  )

  it('throws both errors when both throw', async () => {
    const live = new Error('vitest would not start')
    const reviews = new Error('claude would not start')

    const thrown = await outcomeOf(
      runBoth(
        async () => {
          throw live
        },
        async () => {
          throw reviews
        }
      )
    )

    expect(thrown).toBeInstanceOf(AggregateError)
    expect(thrown).toHaveProperty('errors', [live, reviews])
  })
})

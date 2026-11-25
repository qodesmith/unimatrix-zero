import type {WindowEvents} from './runner'

import {afterEach, describe, expect, it, vi} from 'vitest'

import {
  EXTRACTION_INPUT_LIMIT,
  EXTRACTION_TIMEOUT_MS,
  runExtraction,
} from './runner'
import {jpegBytes, pngBytes} from './test-images'

const PDF = new TextEncoder().encode('%PDF-1.7\n')

function goodOutput() {
  return {
    type: 'read',
    format: 'pdf',
    text: new TextEncoder().encode('Hello'),
    pageImages: [{page: 2, bytes: jpegBytes(1000, 1600)}],
    imagesStopped: false,
  }
}

function fakeWindow(onOpen?: (events: WindowEvents) => void) {
  const fake = {
    opened: [] as Uint8Array[],
    destroyed: 0,
    events: null as WindowEvents | null,
    open: (bytes: Uint8Array, events: WindowEvents) => {
      fake.opened.push(bytes)
      fake.events = events
      onOpen?.(events)

      return {
        destroy: () => {
          fake.destroyed += 1
        },
      }
    },
  }

  return fake
}

function eventsOf(fake: ReturnType<typeof fakeWindow>) {
  if (!fake.events) throw new Error('No window was opened')

  return fake.events
}

afterEach(() => {
  vi.useRealTimers()
})

describe('an extraction job', () => {
  it('opens one window with the file’s bytes, passes good output and destroys the window', async () => {
    const fake = fakeWindow(events => events.message(goodOutput()))

    const result = await runExtraction(PDF, fake.open)

    expect(fake.opened).toEqual([PDF])
    expect(result).toMatchObject({
      type: 'read',
      format: 'pdf',
      text: 'Hello',
      pageImages: [{page: 2}],
    })
    expect(fake.destroyed).toBe(1)
  })

  it('fails a file over the input limit without opening a window', async () => {
    const fake = fakeWindow()

    const result = await runExtraction(
      new Uint8Array(EXTRACTION_INPUT_LIMIT + 1),
      fake.open
    )

    expect(result).toEqual({type: 'failed'})
    expect(fake.opened).toEqual([])
  })

  it.each([
    ['a null message, as a transferred buffer arrives', null],
    [
      'malformed output',
      {...goodOutput(), pageImages: [{page: 1, bytes: pngBytes()}]},
    ],
  ])('fails on %s and destroys the window', async (_case, data) => {
    const fake = fakeWindow(events => events.message(data))

    expect(await runExtraction(PDF, fake.open)).toEqual({type: 'failed'})
    expect(fake.destroyed).toBe(1)
  })

  it('fails at once when the window’s process goes, and destroys it', async () => {
    const fake = fakeWindow()
    const job = runExtraction(PDF, fake.open)

    eventsOf(fake).failed()

    expect(await job).toEqual({type: 'failed'})
    expect(fake.destroyed).toBe(1)
  })

  it('fails and destroys the window when it fails while opening', async () => {
    const fake = fakeWindow(events => events.failed())

    expect(await runExtraction(PDF, fake.open)).toEqual({type: 'failed'})
    expect(fake.destroyed).toBe(1)
  })

  it('fails when the window can’t be opened', async () => {
    const result = await runExtraction(PDF, () => {
      throw new Error('No window')
    })

    expect(result).toEqual({type: 'failed'})
  })

  it('keeps the first message and destroys the window once', async () => {
    const fake = fakeWindow(events => {
      events.message(goodOutput())
      events.message({type: 'failed', message: 'Late'})
      events.failed()
    })

    expect(await runExtraction(PDF, fake.open)).toMatchObject({type: 'read'})
    expect(fake.destroyed).toBe(1)
  })

  it('waits for the window until the timeout, then fails and destroys it', async () => {
    vi.useFakeTimers()
    const fake = fakeWindow()
    const job = runExtraction(PDF, fake.open)
    let settled = false
    void job.finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(EXTRACTION_TIMEOUT_MS - 1)

    expect(settled).toBe(false)
    expect(fake.destroyed).toBe(0)

    await vi.advanceTimersByTimeAsync(1)

    expect(await job).toEqual({type: 'failed'})
    expect(fake.destroyed).toBe(1)
  })
})

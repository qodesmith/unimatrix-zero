import type {ExtractorOutput} from '@uz/contract/extraction'

import {strToU8} from 'fflate'
import {describe, expect, it, vi} from 'vitest'

import {serveJob} from './main'

class FakePort {
  postMessage = vi.fn<(output: ExtractorOutput, ...rest: unknown[]) => void>()
  start = vi.fn<() => void>()
  listeners: ((event: MessageEvent) => void)[] = []

  addEventListener(_type: 'message', listener: (event: MessageEvent) => void) {
    this.listeners.push(listener)
  }

  send(data: {bytes: Uint8Array} | null) {
    for (const listener of this.listeners)
      listener(new MessageEvent('message', {data}))
  }
}

async function nextTask() {
  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
}

describe('serveJob', () => {
  it('posts output for the first job once, as a copy with no transfer list', async () => {
    const port = new FakePort()
    const served = serveJob(port)

    port.send({bytes: strToU8('{\\rtf1 First}')})
    port.send({bytes: strToU8('{\\rtf1 Second}')})
    await served
    await nextTask()

    expect(port.start).toHaveBeenCalled()
    expect(port.postMessage).toHaveBeenCalledTimes(1)
    const [call] = port.postMessage.mock.calls

    expect(call).toHaveLength(1)
    const output = call?.[0]

    if (output?.type !== 'read') throw new Error('expected read output')
    expect(new TextDecoder().decode(output.text)).toBe('First')
  })

  it('fails a job that holds no bytes', async () => {
    const port = new FakePort()
    const served = serveJob(port)

    port.send(null)

    expect(await served).toEqual({type: 'failed', message: expect.any(String)})
    expect(port.postMessage).toHaveBeenCalledWith(await served)
  })
})

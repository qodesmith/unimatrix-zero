import type {ExtractorReply} from '@uz/contract/extraction'

import {strToU8} from 'fflate'
import {describe, expect, it, vi} from 'vitest'

import {serveJob} from './main'

class FakePort {
  postMessage = vi.fn<(reply: ExtractorReply, ...rest: unknown[]) => void>()
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
  it('replies to the first job once, posting a copy with no transfer list', async () => {
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
    const reply = call?.[0]

    if (reply?.type !== 'read') throw new Error('expected a read reply')
    expect(new TextDecoder().decode(reply.text)).toBe('First')
    expect(reply.text.byteLength).toBeGreaterThan(0)
  })

  it('fails a job that holds no bytes', async () => {
    const port = new FakePort()
    const served = serveJob(port)

    port.send(null)

    expect(await served).toEqual({type: 'failed', message: expect.any(String)})
    expect(port.postMessage).toHaveBeenCalledWith(await served)
  })
})

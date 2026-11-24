import type {PdfAssets} from '#modules/pdf/main'
import type {ExtractorReply} from '@uz/contract/extraction'

import {extract} from '#modules/extract/main'
import {EXTRACTION_PORT_MESSAGE} from '@uz/contract/extraction'
import {z} from 'zod'

/** A `MessagePort` as the page uses it: a reply takes no transfer list. */
export interface JobPort {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent) => void
  ) => void
  postMessage: (reply: ExtractorReply) => void
  start: () => void
}

const JobSchema = z.object({bytes: z.instanceof(Uint8Array)})

async function answer(
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the job crosses from main: JobSchema parses it here
  data: unknown,
  assets: PdfAssets | undefined
): Promise<ExtractorReply> {
  const job = JobSchema.safeParse(data)

  if (!job.success) return {type: 'failed', message: 'The job held no file.'}

  return extract(job.data.bytes, assets)
}

/**
 * Answers the first job on the port, and only that one. The reply is a copy:
 * an `ArrayBuffer` transferred to main's `MessagePortMain` arrives as null.
 */
export async function serveJob(port: JobPort, assets?: PdfAssets) {
  const job = new Promise<unknown>(resolve => {
    port.addEventListener('message', event => {
      resolve(event.data)
    })
  })

  port.start()
  const reply = await answer(await job, assets)

  port.postMessage(reply)

  return reply
}

/** Takes the port the preload hands over, and serves its job. */
export function listenForPort(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  assets: PdfAssets
) {
  function take(event: MessageEvent) {
    const [port] = event.ports

    if (event.data !== EXTRACTION_PORT_MESSAGE || !port) return
    target.removeEventListener('message', take)
    void serveJob(port, assets)
  }

  target.addEventListener('message', take)
}

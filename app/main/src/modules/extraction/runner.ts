import type {ExtractionResult} from './output'

import {ATTACHMENT_SIZE_LIMIT} from '@uz/contract/attachments'

import {validateOutput} from './output'

export const EXTRACTION_INPUT_LIMIT = ATTACHMENT_SIZE_LIMIT

export const EXTRACTION_TIMEOUT_MS = 60_000

export interface WindowEvents {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the window's message: validateOutput parses it
  message: (data: unknown) => void
  failed: () => void
}

interface ExtractionWindow {
  destroy: () => void
}

export type OpenExtractionWindow = (
  bytes: Uint8Array,
  events: WindowEvents
) => ExtractionWindow

const FAILED = {type: 'failed'} as const

interface Job {
  result: ExtractionResult | null
}

/**
 * One window per job, destroyed however the job ends: the first message
 * decides, and nothing the window does can make this throw.
 */
export async function runExtraction(
  bytes: Uint8Array,
  open: OpenExtractionWindow
): Promise<ExtractionResult> {
  if (bytes.byteLength > EXTRACTION_INPUT_LIMIT) return FAILED

  return new Promise(resolve => {
    let window: ExtractionWindow | null = null
    const job: Job = {result: null}

    function destroy() {
      try {
        window?.destroy()
      } catch {
        // Already gone.
      }
    }

    function finish(ended: ExtractionResult) {
      if (job.result) return

      job.result = ended
      clearTimeout(timer)
      destroy()
      resolve(ended)
    }

    const timer = setTimeout(() => finish(FAILED), EXTRACTION_TIMEOUT_MS)

    try {
      window = open(bytes, {
        message: data => {
          try {
            finish(validateOutput(data, bytes))
          } catch {
            finish(FAILED)
          }
        },
        failed: () => finish(FAILED),
      })
    } catch {
      finish(FAILED)
    }

    // A window that failed while opening ended the job before it was known.
    if (job.result) destroy()
  })
}

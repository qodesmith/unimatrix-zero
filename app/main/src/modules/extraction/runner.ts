import type {ExtractionResult} from './reply'

import {MIB} from '@uz/contract/sizes'

import {validateReply} from './reply'

/** The attachment limit: a larger file is never extracted. */
export const EXTRACTION_INPUT_LIMIT = 50 * MIB

export const EXTRACTION_TIMEOUT_MS = 60_000

export interface WindowEvents {
  /** The page's message, as it arrived: null for a transferred buffer. */
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the window's message: validateReply parses it
  message: (data: unknown) => void
  /** The window's process went, its page failed to load, or it hung. */
  failed: () => void
}

interface ExtractionWindow {
  destroy: () => void
}

/** Opens a hidden window, loads the extractor and posts it the bytes. */
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
            finish(validateReply(data, bytes))
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

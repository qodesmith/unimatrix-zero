import type {DroppedFileError, DroppedFileOutcome} from '@uz/contract/bridge'
import type {IpcMain, IpcMainInvokeEvent} from 'electron'

import {BRIDGE_CHANNELS, DroppedFileRegistration} from '@uz/contract/bridge'
import {randomUUID} from 'node:crypto'

const refused = (
  code: DroppedFileError['code'],
  message: string
): DroppedFileOutcome => ({ok: false, error: {code, message}})

/**
 * Real paths enter main only here, handed over by the preload; the page gets an
 * id.
 */
export function createDroppedFiles() {
  const paths = new Map<string, string>()

  const register = (raw: unknown): DroppedFileOutcome => {
    const parsed = DroppedFileRegistration.safeParse(raw)
    if (!parsed.success || parsed.data.path === '') {
      return refused('no-path', 'The dropped file has no path.')
    }
    const id = randomUUID()
    paths.set(id, parsed.data.path)
    return {ok: true, id}
  }

  return {
    register,
    listen(
      ipcMain: IpcMain,
      isTrusted: (event: IpcMainInvokeEvent) => boolean
    ) {
      ipcMain.handle(BRIDGE_CHANNELS.droppedFile, (event, raw: unknown) =>
        isTrusted(event)
          ? register(raw)
          : refused(
              'untrusted-sender',
              'Dropped files are accepted from the app window only.'
            )
      )
    },
  }
}

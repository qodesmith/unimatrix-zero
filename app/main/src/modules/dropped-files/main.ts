import type {DroppedFileId, DroppedFileReply} from '@uz/contract/bridge'
import type {IpcMain, IpcMainInvokeEvent} from 'electron'

import {BRIDGE_CHANNELS} from '@uz/contract/bridge'
import {randomUUID} from 'node:crypto'

/** Real paths enter only here, handed over by the preload. The page sees ids. */
export function createDroppedFiles() {
  const paths = new Map<DroppedFileId, string>()

  const register = (filePath: string): DroppedFileReply => {
    if (filePath === '') {
      return {
        ok: false,
        error: {code: 'no-path', message: 'The dropped file has no path.'},
      }
    }
    const id = randomUUID()
    paths.set(id, filePath)
    return {ok: true, id}
  }

  return {
    register,
    resolve: (id: DroppedFileId) => paths.get(id) ?? null,
    listen(
      ipcMain: IpcMain,
      isTrusted: (event: IpcMainInvokeEvent) => boolean
    ) {
      ipcMain.handle(
        BRIDGE_CHANNELS.droppedFile,
        (event, dropped: {path?: unknown}): DroppedFileReply => {
          if (!isTrusted(event) || typeof dropped.path !== 'string') {
            return {
              ok: false,
              error: {
                code: 'no-path',
                message: 'The dropped file has no path.',
              },
            }
          }
          return register(dropped.path)
        }
      )
    },
  }
}

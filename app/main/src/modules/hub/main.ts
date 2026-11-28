import type {AppEvent} from '@uz/contract/events'
import type {IpcMain, IpcMainEvent} from 'electron'

import {BRIDGE_CHANNELS} from '@uz/contract/bridge'

type Snapshot = Extract<AppEvent, {type: 'SNAPSHOT'}>

type Send = (event: AppEvent) => void

export type Hub = ReturnType<typeof createHub>

/**
 * A window gets a `SNAPSHOT`, then every later event. Main is single-threaded,
 * so no event is missed or doubled between the two.
 */
export function createHub(snapshot: () => Snapshot) {
  const windows = new Map<number, Send>()

  function connect(windowId: number, send: Send) {
    windows.set(windowId, send)
    send(snapshot())
  }

  function disconnect(windowId: number) {
    windows.delete(windowId)
  }

  function publish(event: AppEvent) {
    for (const send of windows.values()) send(event)

    return windows.size > 0
  }

  return {connect, disconnect, publish}
}

export function registerSubscribeChannel(
  ipcMain: IpcMain,
  hub: Hub,
  isTrusted: (event: IpcMainEvent) => boolean
) {
  const watched = new Set<number>()

  ipcMain.on(BRIDGE_CHANNELS.subscribe, event => {
    if (!isTrusted(event)) return

    const contents = event.sender
    const windowId = contents.id

    if (!watched.has(windowId)) {
      watched.add(windowId)
      contents.once('destroyed', () => {
        watched.delete(windowId)
        hub.disconnect(windowId)
      })
    }

    hub.connect(windowId, appEvent =>
      contents.send(BRIDGE_CHANNELS.event, appEvent)
    )
  })
}

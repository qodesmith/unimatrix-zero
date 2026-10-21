import type {AppEvent} from '@uz/contract/events'
import type {IpcMain, IpcMainEvent} from 'electron'

import {BRIDGE_CHANNELS} from '@uz/contract/bridge'

type Snapshot = Extract<AppEvent, {type: 'SNAPSHOT'}>

type Send = (event: AppEvent) => void

export type Hub = ReturnType<typeof createHub>

/**
 * Main's event fan-out. A window that connects gets a `SNAPSHOT` and then every
 * event published after it; main is single-threaded, so nothing falls between
 * the two and nothing arrives twice.
 */
export function createHub(snapshot: () => Snapshot) {
  const windows = new Map<number, Send>()

  /** Connecting again (a reload) replaces the window's earlier connection. */
  function connect(windowId: number, send: Send) {
    windows.set(windowId, send)
    send(snapshot())
  }

  function disconnect(windowId: number) {
    windows.delete(windowId)
  }

  function publish(event: AppEvent) {
    for (const send of windows.values()) send(event)
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

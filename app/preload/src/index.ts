import type {Bridge} from '@uz/contract/bridge'
import type {IpcRendererEvent} from 'electron'

import {BRIDGE_CHANNELS} from '@uz/contract/bridge'
import {EventSchema} from '@uz/contract/events'
import {contextBridge, ipcRenderer, webUtils} from 'electron'

const uz: Bridge = {
  send: async command => ipcRenderer.invoke(BRIDGE_CHANNELS.command, command),

  subscribe: listener => {
    function deliver(
      _event: IpcRendererEvent,
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the IPC boundary: EventSchema parses it below
      payload: unknown
    ) {
      listener(EventSchema.parse(payload))
    }

    ipcRenderer.on(BRIDGE_CHANNELS.event, deliver)
    ipcRenderer.send(BRIDGE_CHANNELS.subscribe)

    return () => ipcRenderer.off(BRIDGE_CHANNELS.event, deliver)
  },

  registerDroppedFile: async file =>
    ipcRenderer.invoke(BRIDGE_CHANNELS.droppedFile, {
      path: webUtils.getPathForFile(file),
    }),
}

contextBridge.exposeInMainWorld('uz', uz)

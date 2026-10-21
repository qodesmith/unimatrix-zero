import type {Bridge} from '@uz/contract/bridge'
import type {AppEvent} from '@uz/contract/events'
import type {IpcRendererEvent} from 'electron'

import {BRIDGE_CHANNELS} from '@uz/contract/bridge'
import {contextBridge, ipcRenderer, webUtils} from 'electron'

const uz: Bridge = {
  send: async command => ipcRenderer.invoke(BRIDGE_CHANNELS.command, command),

  subscribe: listener => {
    // Main is the only sender on this channel, and it sends AppEvents.
    function deliver(_event: IpcRendererEvent, payload: AppEvent) {
      listener(payload)
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

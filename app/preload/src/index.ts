import type {Bridge} from '@uz/contract/bridge'

import {BRIDGE_CHANNELS} from '@uz/contract/bridge'
import {contextBridge, ipcRenderer, webUtils} from 'electron'

const uz: Bridge = {
  send: command => ipcRenderer.invoke(BRIDGE_CHANNELS.command, command),

  subscribe: listener => {
    const deliver = (_event: unknown, payload: unknown) =>
      listener(payload as Parameters<typeof listener>[0])
    ipcRenderer.on(BRIDGE_CHANNELS.event, deliver)
    ipcRenderer.send(BRIDGE_CHANNELS.subscribe)
    return () => ipcRenderer.off(BRIDGE_CHANNELS.event, deliver)
  },

  registerDroppedFile: file =>
    ipcRenderer.invoke(BRIDGE_CHANNELS.droppedFile, {
      path: webUtils.getPathForFile(file),
    }),
}

contextBridge.exposeInMainWorld('uz', uz)

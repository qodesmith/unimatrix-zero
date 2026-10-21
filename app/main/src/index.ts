import type {AppEvent} from '@uz/contract/events'

import {
  hmrOrigin,
  proxyDevServer,
  registerAppSchemes,
  serveBundle,
} from '#modules/app-protocol/main'
import {registerCommandChannel} from '#modules/commands/main'
import {readDevRun} from '#modules/dev/main'
import {createDroppedFiles} from '#modules/dropped-files/main'
import {
  createWindow,
  hardenSession,
  isTopLevelAppFrame,
} from '#modules/window/main'
import {BRIDGE_CHANNELS} from '@uz/contract/bridge'
import {app, ipcMain, protocol, session} from 'electron'
import path from 'node:path'

const dev = readDevRun(process.env)

const preloadPath = path.join(
  import.meta.dirname,
  '../../preload/dist/preload.cjs'
)

const rendererDist = path.join(import.meta.dirname, '../../renderer/dist')

app.setName('Unimatrix Zero')

registerAppSchemes()

function openWindow() {
  const windowSession = session.defaultSession
  hardenSession(windowSession, dev ? [hmrOrigin({port: dev.vitePort})] : [])

  const url = dev
    ? proxyDevServer(protocol, {
        port: dev.vitePort,
        scriptNonce: dev.scriptNonce,
      })
    : serveBundle(protocol, rendererDist)

  function fromAppWindow(event: Parameters<typeof isTopLevelAppFrame>[0]) {
    return isTopLevelAppFrame(event, url)
  }

  registerCommandChannel(ipcMain, event => ({
    isTopLevelAppFrame: fromAppWindow(event),
  }))
  createDroppedFiles().listen(ipcMain, fromAppWindow)
  ipcMain.on(BRIDGE_CHANNELS.subscribe, event => {
    if (!fromAppWindow(event)) return

    const snapshot: AppEvent = {
      type: 'SNAPSHOT',
      app: {version: app.getVersion()},
    }

    event.sender.send(BRIDGE_CHANNELS.event, snapshot)
  })

  createWindow({
    session: windowSession,
    preloadPath,
    url,
    packaged: app.isPackaged,
  })
}

void app.whenReady().then(openWindow)

app.on('window-all-closed', () => app.quit())

import type {IpcMainInvokeEvent} from 'electron'

import {
  APP_DEV_SCHEME,
  APP_SCHEME,
  hmrOrigin,
  proxyDevServer,
  registerAppSchemes,
  serveBundle,
} from '#modules/app-protocol/main'
import {registerCommandChannel} from '#modules/commands/main'
import {readDevRun} from '#modules/dev/main'
import {createDroppedFiles} from '#modules/dropped-files/main'
import {createWindow, hardenSession} from '#modules/window/main'
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

app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', event => event.preventDefault())
})

void app.whenReady().then(() => {
  const windowSession = session.defaultSession
  hardenSession(windowSession, dev ? [hmrOrigin({port: dev.vitePort})] : [])

  const url = dev
    ? proxyDevServer(protocol, {
        port: dev.vitePort,
        scriptNonce: dev.scriptNonce,
      })
    : serveBundle(protocol, rendererDist)

  const appOrigin = new URL(url).origin
  const isTopLevelAppFrame = (event: IpcMainInvokeEvent) => {
    const frame = event.senderFrame
    if (!frame || frame !== event.sender.mainFrame) return false
    const origin = new URL(frame.url).origin
    return (
      origin === appOrigin &&
      [APP_SCHEME, APP_DEV_SCHEME].includes(frame.url.split(':')[0] ?? '')
    )
  }

  registerCommandChannel(ipcMain, event => ({
    isTopLevelAppFrame: isTopLevelAppFrame(event),
  }))
  createDroppedFiles().listen(ipcMain, isTopLevelAppFrame)
  ipcMain.on(BRIDGE_CHANNELS.subscribe, event => {
    if (event.senderFrame !== event.sender.mainFrame) return
    event.sender.send(BRIDGE_CHANNELS.event, {
      type: 'SNAPSHOT',
      app: {version: app.getVersion()},
    })
  })

  createWindow({
    session: windowSession,
    preloadPath,
    url,
    packaged: app.isPackaged,
  })
})

app.on('window-all-closed', () => app.quit())

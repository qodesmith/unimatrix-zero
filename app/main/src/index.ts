import type {Database} from '#modules/database/main'

import {
  hmrOrigin,
  proxyDevServer,
  registerAppSchemes,
  serveBundle,
} from '#modules/app-protocol/main'
import {registerCommandChannel} from '#modules/commands/main'
import {DatabaseOpenError, openDatabase} from '#modules/database/main'
import {readDevRun} from '#modules/dev/main'
import {createDroppedFiles} from '#modules/dropped-files/main'
import {createHub, registerSubscribeChannel} from '#modules/hub/main'
import {createTrees} from '#modules/trees/main'
import {
  createWindow,
  hardenSession,
  isTopLevelAppFrame,
} from '#modules/window/main'
import {app, dialog, ipcMain, protocol, session} from 'electron'
import path from 'node:path'

const dev = readDevRun(process.env)

const preloadPath = path.join(
  import.meta.dirname,
  '../../preload/dist/preload.cjs'
)

const rendererDist = path.join(import.meta.dirname, '../../renderer/dist')

const migrationsFolder = path.join(import.meta.dirname, '../drizzle')

app.setName('Unimatrix Zero')

registerAppSchemes()

function openData(): Database | null {
  try {
    return openDatabase({
      file: path.join(app.getPath('userData'), 'data', 'unimatrix.sqlite'),
      migrationsFolder,
    })
  } catch (error) {
    dialog.showErrorBox(
      'Unimatrix Zero can’t open your data',
      error instanceof DatabaseOpenError
        ? error.message
        : `Something unexpected went wrong while opening it (${String(error)}).`
    )

    return null
  }
}

function openWindow(db: Database) {
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

  const hub = createHub(() => ({
    type: 'SNAPSHOT',
    app: {version: app.getVersion()},
  }))

  registerCommandChannel(
    ipcMain,
    event => ({isTopLevelAppFrame: fromAppWindow(event)}),
    {now: () => new Date(), trees: createTrees(db), publish: hub.publish}
  )
  createDroppedFiles().listen(ipcMain, fromAppWindow)
  registerSubscribeChannel(ipcMain, hub, fromAppWindow)

  createWindow({
    session: windowSession,
    preloadPath,
    url,
    packaged: app.isPackaged,
  })
}

async function start() {
  await app.whenReady()
  const db = openData()

  if (!db) {
    app.quit()

    return
  }

  app.on('will-quit', () => db.$client.close())
  openWindow(db)
}

void start()

app.on('window-all-closed', () => app.quit())

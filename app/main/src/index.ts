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
import {utilityHost} from '#modules/host-process/main'
import {createHub, registerSubscribeChannel} from '#modules/hub/main'
import {createProviderHosts} from '#modules/provider-hosts/main'
import {createTrees} from '#modules/trees/main'
import {createTurns} from '#modules/turns/main'
import {
  createWindow,
  hardenSession,
  isTopLevelAppFrame,
} from '#modules/window/main'
import {PROVIDER_NAMES} from '@uz/contract/providers'
import {app, dialog, ipcMain, protocol, session} from 'electron'
import path from 'node:path'

const dev = readDevRun(process.env)

const preloadPath = path.join(
  import.meta.dirname,
  '../../preload/dist/preload.cjs'
)

const rendererDist = path.join(import.meta.dirname, '../../renderer/dist')

const hostsDist = path.join(import.meta.dirname, '../../provider-host/dist')

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
    replies: turns.streaming(),
  }))

  const turns = createTurns(db, hub.publish)

  const hosts = createProviderHosts({
    spawn: utilityHost(hostsDist, dev?.fakeProvider ? ['--fake'] : []),
    onReplyEvent: turns.apply,
    onCrash: provider =>
      turns.failAll(provider, {
        code: 'host-crashed',
        message: `${PROVIDER_NAMES[provider]} stopped unexpectedly.`,
      }),
  })

  app.on('will-quit', () => {
    hosts.stopAll()
    turns.saveAll()
  })

  // Connecting a Provider comes with the Connections screen; until then only
  // the fake one connects.
  if (dev?.fakeProvider) hosts.connect('claude')

  registerCommandChannel(
    ipcMain,
    event => ({isTopLevelAppFrame: fromAppWindow(event)}),
    {
      now: () => new Date(),
      trees: createTrees(db),
      turns,
      hosts,
      publish: hub.publish,
    }
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

  openWindow(db)
  // After openWindow's will-quit, which saves the Replies still streaming.
  app.on('will-quit', () => db.$client.close())
}

void start()

app.on('window-all-closed', () => app.quit())

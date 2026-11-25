import type {Database} from '#modules/database/main'
import type {GitNews} from '#modules/git-program/main'
import type {AppEvent} from '@uz/contract/events'

import {
  hmrOrigin,
  proxyDevServer,
  registerAppSchemes,
  serveAttachments,
  serveBundle,
} from '#modules/app-protocol/main'
import {createAttachments} from '#modules/attachments/main'
import {registerCommandChannel} from '#modules/commands/main'
import {createConnections} from '#modules/connections/main'
import {DatabaseOpenError, openDatabase} from '#modules/database/main'
import {readDevRun} from '#modules/dev/main'
import {writeDeveloperFolder} from '#modules/developer-folder/main'
import {createDroppedFiles} from '#modules/dropped-files/main'
import {
  extractionSession,
  extractionWindows,
} from '#modules/extraction-window/main'
import {runExtraction} from '#modules/extraction/main'
import {createGitProgram} from '#modules/git-program/main'
import {
  shippedGitExe,
  writeGitWrapper,
  writeWindowsGitWrapper,
} from '#modules/git-wrapper/main'
import {utilityHost} from '#modules/host-process/main'
import {createHub, registerSubscribeChannel} from '#modules/hub/main'
import {createLayout} from '#modules/layout/main'
import {createProviderHosts} from '#modules/provider-hosts/main'
import {createRemoteImages} from '#modules/remote-images/main'
import {createSessions} from '#modules/sessions/main'
import {createSettings} from '#modules/settings/main'
import {createSystemPrompts} from '#modules/system-prompts/main'
import {createTitles} from '#modules/titles/main'
import {createTreeFiles} from '#modules/tree-files/main'
import {createTreeRows, createTrees} from '#modules/trees/main'
import {createTurns} from '#modules/turns/main'
import {
  developerFolderFor,
  gitFolderFor,
  gitTargetFor,
  needsNewerLinux,
  readGlibcVersion,
  signInRequestFor,
} from '#modules/vendor-programs/main'
import {
  createWindow,
  followThemeMode,
  hardenSession,
  isTopLevelAppFrame,
  openLink,
  setAppMenu,
} from '#modules/window/main'
import {compactionSettingsFor} from '@uz/contract/settings'
import {getProgramReady, programOf} from '@uz/vendor-program'
import {app, dialog, ipcMain, protocol, session} from 'electron'
import path from 'node:path'

const dev = readDevRun(process.env)

const preloadPath = path.join(
  import.meta.dirname,
  '../../preload/dist/preload.cjs'
)

const extractionPreloadPath = path.join(
  import.meta.dirname,
  '../../preload/dist/extraction.cjs'
)

const rendererDist = path.join(import.meta.dirname, '../../renderer/dist')

const extractorDist = path.join(import.meta.dirname, '../../extractor/dist')

const hostsDist = path.join(import.meta.dirname, '../../provider-host/dist')

const migrationsFolder = path.join(import.meta.dirname, '../drizzle')

const GIT_NEWS = {
  downloading: 'SNAPSHOTS_WAITING',
  'download-failed': 'SNAPSHOTS_DOWNLOAD_FAILED',
  downloaded: 'SNAPSHOTS_DOWNLOADED',
  'needs-newer-linux': 'SNAPSHOTS_NEED_NEWER_LINUX',
} as const satisfies Record<GitNews, AppEvent['type']>

/**
 * Only in a checkout: once packaging is built, the shell must ship these and
 * main must read them from its resources.
 */
const gitExes = path.join(import.meta.dirname, '../../../shell/git-exe/dist')

// Electron's default opens a modal dialog that main waits behind.
process.on('uncaughtException', error => {
  process.stderr.write(`Uncaught: ${error.stack ?? String(error)}\n`)
})

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

  const settings = createSettings(db, saved => followThemeMode(saved.themeMode))
  followThemeMode(settings.read().themeMode)
  const systemPrompts = createSystemPrompts(db, settings)
  const layout = createLayout(db)

  const hub = createHub(() => ({
    type: 'SNAPSHOT',
    app: {version: app.getVersion()},
    replies: turns.streaming(),
    ...connections.snapshot(),
    lastModel: turns.lastModel(),
    settings: settings.read(),
    systemPrompts: systemPrompts.list(),
    layout: layout.read(),
  }))

  const sessions = createSessions(db, (provider, sessionId, uuids) =>
    turns.hostSessionAppended(provider, sessionId, uuids)
  )

  const attachmentsDir = path.join(app.getPath('userData'), 'attachments')
  const droppedFiles = createDroppedFiles()

  const openExtraction = extractionWindows(
    extractionSession(extractorDist),
    extractionPreloadPath
  )

  const attachments = createAttachments({
    db,
    dir: attachmentsDir,
    droppedPath: droppedFiles.pathOf,
    extract: async bytes => runExtraction(bytes, openExtraction),
  })

  serveAttachments(protocol, id => attachments.original(id))

  const trees = createTrees(db)
  const treeRows = createTreeRows(trees, hub.publish)

  const hosts = createProviderHosts({
    spawn: utilityHost(hostsDist, dev?.fakeProvider ? ['--fake'] : []),
    onReplyEvent: (provider, event) => turns.hostEvent(provider, event),
    onPromptRecorded: (provider, recorded) =>
      turns.hostPromptRecorded(provider, recorded),
    onPromptDropped: (provider, dropped) =>
      turns.hostPromptDropped(provider, dropped),
    onSessionCut: (provider, cut) => turns.hostSessionCut(provider, cut),
    onReplyRecorded: (provider, recorded) =>
      turns.hostRecorded(provider, recorded),
    onSessionStore: sessions.handle,
    onSignInUpdate: (provider, update) =>
      connections.applySignInUpdate(provider, update),
    onModels: (provider, models) => connections.applyModels(provider, models),
    onStatus: (provider, status) =>
      connections.applyHostStatus(provider, status),
    onCrash: provider => {
      turns.hostCrashed(provider)
      connections.hostCrashed(provider)
    },
  })

  const machine = {
    userData: app.getPath('userData'),
    platform: process.platform,
    arch: process.arch,
    glibcVersion: readGlibcVersion(),
  }

  const gitTarget = gitTargetFor(machine)
  const developerFolder = developerFolderFor(machine)

  // Before any host starts, so the stubs find the script.
  if (developerFolder) {
    writeDeveloperFolder(developerFolder, gitTarget && programOf(gitTarget))
  }

  const gitFolder = gitFolderFor(machine)

  if (gitFolder && gitTarget) {
    if (machine.platform === 'win32') {
      writeWindowsGitWrapper(
        gitFolder,
        programOf(gitTarget),
        shippedGitExe(gitExes, machine.arch)
      )
    } else {
      writeGitWrapper(gitFolder, programOf(gitTarget))
    }
  }

  const gitProgram = createGitProgram({
    target: gitTarget,
    needsNewerLinux: needsNewerLinux(machine),
    getProgramReady,
    tell: news => hub.publish({type: GIT_NEWS[news]}),
  })

  const treeFiles = createTreeFiles({
    db,
    userData: machine.userData,
    publish: hub.publish,
    onFailure: ({message}) => {
      process.stderr.write(`A Snapshot failed: ${message}\n`)
    },
    gitProgram: gitProgram.program,
    onWaitingForGit: () => gitProgram.snapshotWaited(),
  })

  const titles = createTitles({
    trees,
    turnsOf: treeId => turns.list(treeId),
    runOneShot: async (provider, request) =>
      hosts.runOneShot(provider, request),
    vendorProgramFor: provider => signInRequestFor(provider, machine),
    publish: hub.publish,
  })

  // Before any host starts, so a Reply left streaming is marked interrupted.
  const turns = createTurns({
    db,
    publish: hub.publish,
    hosts,
    vendorProgramFor: provider => signInRequestFor(provider, machine),
    treeFolderFor: treeFiles.folderFor,
    snapshotsBefore: treeFiles.snapshotsBefore,
    compactionSettingsFor: provider =>
      compactionSettingsFor(settings.read(), provider),
    listedModels: provider => connections.models(provider),
    attachmentsDir,
    now: () => new Date(),
    onTurnsChanged: treeRows.turnsChanged,
    onReplyFinished: finished => {
      if (finished.failure?.code === 'needs-app-update') {
        connections.markNeedsAppUpdate(finished.provider, finished.model)
      }

      treeRows.replyFinished(finished)
      void treeFiles.replyFinished(finished)
      void titles.replyFinished(finished)
    },
  })

  async function downloadGitAgain() {
    if (await gitProgram.tryAgain()) await treeFiles.takeMissedSnapshots()
  }

  // Waits for git, or missed Snapshots would be recorded as waiting.
  void gitProgram.prepare().then(async () => treeFiles.takeMissedSnapshots())

  const connections = createConnections({
    db,
    hosts,
    publish: hub.publish,
    requestFor: provider => {
      const request = signInRequestFor(provider, machine)

      return request.program || dev?.fakeProvider ? request : null
    },
    openExternal: openLink,
    now: () => new Date(),
  })

  app.on('will-quit', () => {
    hosts.stopAll()
    turns.quitting()
  })

  connections.startConnected()

  registerCommandChannel(
    ipcMain,
    event => ({isTopLevelAppFrame: fromAppWindow(event)}),
    {
      now: () => new Date(),
      trees,
      turns,
      treeFiles,
      connections,
      attachments,
      images: createRemoteImages(globalThis.fetch),
      settings,
      systemPrompts,
      layout,
      downloadGitAgain: () => {
        void downloadGitAgain()
      },
      publish: hub.publish,
    }
  )
  droppedFiles.listen(ipcMain, fromAppWindow)
  registerSubscribeChannel(ipcMain, hub, fromAppWindow)

  setAppMenu()
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
  // After openWindow's will-quit, which saves Replies still streaming.
  app.on('will-quit', () => db.$client.close())
}

void start()

app.on('window-all-closed', () => app.quit())

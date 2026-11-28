import type {OpenExtractionWindow, WindowEvents} from '#modules/extraction/main'
import type {ExtractionJob} from '@uz/contract/extraction'
import type {MessagePortMain, Session, WebContents} from 'electron'

import {serveExtractor} from '#modules/app-protocol/main'
import {LOCKED_DOWN_PREFERENCES} from '#modules/window/main'
import {EXTRACTION_PORT_MESSAGE} from '@uz/contract/extraction'
import {BrowserWindow, MessageChannelMain, session} from 'electron'

const PARTITION = 'uz-extraction'

const REFUSED_URLS = [
  'http://*/*',
  'https://*/*',
  'ws://*/*',
  'wss://*/*',
  'file:///*',
  'ftp://*/*',
]

/**
 * A session that serves the extractor's bundle and refuses everything else:
 * the network, files, permissions and downloads (ADR 0014).
 */
export function extractionSession(distDir: string) {
  const extraction = session.fromPartition(PARTITION)

  extraction.webRequest.onBeforeRequest(
    {urls: REFUSED_URLS},
    (_details, callback) => {
      callback({cancel: true})
    }
  )

  for (const scheme of ['file', 'http', 'https']) {
    extraction.protocol.handle(scheme, () => new Response(null, {status: 403}))
  }

  extraction.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  extraction.setPermissionCheckHandler(() => false)
  extraction.on('will-download', event => event.preventDefault())

  return {
    session: extraction,
    url: serveExtractor(extraction.protocol, distDir),
  }
}

function lockDown(contents: WebContents) {
  contents.on('will-navigate', event => event.preventDefault())
  contents.on('will-redirect', event => event.preventDefault())
  contents.on('will-attach-webview', event => event.preventDefault())
  contents.setWindowOpenHandler(() => ({action: 'deny'}))
}

/** A listener that throws would reach `uncaughtException`: it fails instead. */
function safely(events: WindowEvents, run: () => void) {
  try {
    run()
  } catch {
    events.failed()
  }
}

function hiddenWindow(extraction: Session, preloadPath: string) {
  return new BrowserWindow({
    show: false,
    skipTaskbar: true,
    focusable: false,
    width: 800,
    height: 600,
    webPreferences: {
      ...LOCKED_DOWN_PREFERENCES,
      session: extraction,
      preload: preloadPath,
      devTools: false,
      backgroundThrottling: false,
      disableDialogs: true,
    },
  })
}

function startJob(
  contents: WebContents,
  bytes: Uint8Array,
  events: WindowEvents
) {
  const {port1, port2} = new MessageChannelMain()
  port1.on('message', message => {
    safely(events, () => events.message(message.data))
  })
  port1.on('close', () => {
    safely(events, () => events.failed())
  })
  port1.start()
  contents.postMessage(EXTRACTION_PORT_MESSAGE, null, [port2])
  // A copy, not a transfer, which can arrive as null; and a tight one, as a
  // dropped file's bytes are a view on a buffer of the size limit.
  const job: ExtractionJob = {bytes: bytes.slice()}
  port1.postMessage(job)

  return port1
}

export function extractionWindows(
  extraction: {session: Session; url: string},
  preloadPath: string
): OpenExtractionWindow {
  return (bytes, events) => {
    const window = hiddenWindow(extraction.session, preloadPath)
    const contents = window.webContents
    let port: MessagePortMain | null = null

    function failed() {
      safely(events, () => events.failed())
    }

    lockDown(contents)
    contents.on('render-process-gone', failed)
    window.on('unresponsive', failed)
    contents.on(
      'did-fail-load',
      (_event, _code, _description, _url, isMainFrame) => {
        if (isMainFrame) failed()
      }
    )
    contents.once('did-finish-load', () => {
      safely(events, () => {
        port = startJob(contents, bytes, events)
      })
    })
    window.loadURL(extraction.url).catch(failed)

    return {
      destroy: () => {
        port?.close()

        if (!window.isDestroyed()) window.destroy()
      },
    }
  }
}

import type {Session, WebContents} from 'electron'

import {BrowserWindow, shell} from 'electron'

import {isAppUrl} from './app-url'
import {isOpenableExternally} from './link-rule'

export {isTopLevelAppFrame} from './app-url'

type WindowOptions = {
  session: Session
  preloadPath: string
  url: string
  packaged: boolean
}

/**
 * The one window type. Every `webPreferences` value is explicit, the window
 * never navigates, and new windows and webviews are refused.
 */
export function createWindow({
  session,
  preloadPath,
  url,
  packaged,
}: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Unimatrix Zero',
    webPreferences: {
      session,
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      webviewTag: false,
      plugins: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      enableBlinkFeatures: '',
      navigateOnDragDrop: false,
      devTools: !packaged,
      spellcheck: false,
    },
  })

  lockNavigation(window.webContents, url)
  window.once('ready-to-show', () => window.show())
  void window.loadURL(url)
  return window
}

function lockNavigation(contents: WebContents, appUrl: string) {
  const divert = (details: {preventDefault: () => void}, target: string) => {
    if (isAppUrl(target, appUrl)) return
    details.preventDefault()
    openLink(target)
  }
  contents.on('will-navigate', divert)
  contents.on('will-redirect', divert)
  contents.setWindowOpenHandler(({url}) => {
    openLink(url)
    return {action: 'deny'}
  })
  contents.on('will-attach-webview', event => event.preventDefault())
}

function openLink(url: string) {
  if (isOpenableExternally(url)) void shell.openExternal(url)
}

/**
 * The window's session backstop: nothing reaches the network over http or ws,
 * whatever the CSP says. The only allowance is the dev-server HMR socket.
 */
export function hardenSession(session: Session, allowedOrigins: string[]) {
  session.webRequest.onBeforeRequest(
    {urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']},
    (details, callback) => {
      callback({cancel: !allowedOrigins.includes(new URL(details.url).origin)})
    }
  )
  session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(permission === 'clipboard-sanitized-write')
  })
  session.setPermissionCheckHandler(
    (_contents, permission) => permission === 'clipboard-sanitized-write'
  )
}

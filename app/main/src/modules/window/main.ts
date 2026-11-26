import type {ThemeMode} from '@uz/contract/settings'
import type {Session, WebContents, WebPreferences} from 'electron'

import {BrowserWindow, Menu, nativeTheme, shell} from 'electron'

import {isAppUrl} from './app-url'
import {isOpenableExternally} from './link-rule'
import {menuTemplate} from './menu'

export {isTopLevelAppFrame} from './app-url'

interface WindowOptions {
  session: Session
  preloadPath: string
  url: string
  packaged: boolean
}

/**
 * What every window of the app sets, the hidden extraction window too:
 * explicit values, never Electron's defaults (ADR 0014).
 */
export const LOCKED_DOWN_PREFERENCES = {
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
  spellcheck: false,
  zoomFactor: 1,
} as const satisfies WebPreferences

export function createWindow({
  session,
  preloadPath,
  url,
  packaged,
}: WindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 768,
    minHeight: 480,
    // Under 768 px of page, shadcn's Sidebar turns into a slide-over panel.
    useContentSize: true,
    show: false,
    title: 'Unimatrix Zero',
    webPreferences: {
      ...LOCKED_DOWN_PREFERENCES,
      session,
      preload: preloadPath,
      devTools: !packaged,
    },
  })

  lockNavigation(window.webContents, url)
  lockWebRtc(window.webContents)
  window.once('ready-to-show', () => window.show())
  void window.loadURL(url)

  return window
}

function lockNavigation(contents: WebContents, appUrl: string) {
  function divert(details: {preventDefault: () => void}, target: string) {
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

/**
 * Stops WebRTC's UDP; its TCP still goes direct without `hardenSession`'s
 * proxy.
 */
export function lockWebRtc(contents: WebContents) {
  contents.setWebRTCIPHandlingPolicy('disable_non_proxied_udp')
}

export function setAppMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(menuTemplate(process.platform))
  )
}

/** Call before the window opens: `prefers-color-scheme` follows `themeSource`. */
export function followThemeMode(mode: ThemeMode) {
  nativeTheme.themeSource = mode
}

export function openLink(url: string) {
  if (isOpenableExternally(url)) void shell.openExternal(url)
}

/**
 * Blocks http and ws except `allowedOrigins`, whatever the CSP says, and every
 * download: `uzfile://` serves a file it doesn't preview as one.
 */
export function hardenSession(session: Session, allowedOrigins: string[]) {
  // Neither the CSP nor the request filter covers WebRTC: with `lockWebRtc` it
  // may send only through this proxy, on a closed port. Chromium never proxies
  // loopback, so Vite's HMR socket still connects (ADR 0014).
  void session.setProxy({
    mode: 'fixed_servers',
    proxyRules: 'http://127.0.0.1:9',
  })
  session.on('will-download', event => event.preventDefault())
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

import type {BrowserWindow, Session, WebContents} from 'electron'

import {fromPartial} from '@total-typescript/shoehorn'
import {expect, it, vi} from 'vitest'

import {hardenSession, lockWebRtc, showWhenReady} from './main'

function fakeSession() {
  return {
    on: vi.fn<Session['on']>(),
    webRequest: {onBeforeRequest: vi.fn<() => void>()},
    setPermissionRequestHandler: vi.fn<() => void>(),
    setPermissionCheckHandler: vi.fn<() => void>(),
    setProxy: vi.fn<Session['setProxy']>(async () => {}),
  }
}

it('hands the session a proxy on a closed loopback port', () => {
  const session = fakeSession()

  hardenSession(fromPartial<Session>(session), [])

  expect(session.setProxy).toHaveBeenCalledWith({
    mode: 'fixed_servers',
    proxyRules: 'http://127.0.0.1:9',
  })
})

it('lets WebRTC send nothing but through the proxy', () => {
  const contents = {
    setWebRTCIPHandlingPolicy:
      vi.fn<WebContents['setWebRTCIPHandlingPolicy']>(),
  }

  lockWebRtc(fromPartial<WebContents>(contents))

  expect(contents.setWebRTCIPHandlingPolicy).toHaveBeenCalledWith(
    'disable_non_proxied_udp'
  )
})

function fakeWindow() {
  const fired = new Map<string, () => void>()

  const window = {
    show: vi.fn<() => void>(),
    once: vi.fn<(event: string, listener: () => void) => void>(
      (event, listener) => {
        fired.set(event, listener)
      }
    ),
    webContents: {
      once: vi.fn<(event: string, listener: () => void) => void>(
        (event, listener) => {
          fired.set(event, listener)
        }
      ),
    },
  }

  return {window, fire: (event: string) => fired.get(event)?.()}
}

it('shows the window on Linux once the page has loaded, with no first paint', () => {
  const {window, fire} = fakeWindow()

  showWhenReady(fromPartial<BrowserWindow>(window), 'linux')
  fire('did-finish-load')

  expect(window.show).toHaveBeenCalledOnce()
})

it('keeps the window hidden on a Mac until its first paint', () => {
  const {window, fire} = fakeWindow()

  showWhenReady(fromPartial<BrowserWindow>(window), 'darwin')
  fire('did-finish-load')

  expect(window.show).not.toHaveBeenCalled()

  fire('ready-to-show')

  expect(window.show).toHaveBeenCalledOnce()
})

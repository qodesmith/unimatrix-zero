import type {Session, WebContents} from 'electron'

import {fromPartial} from '@total-typescript/shoehorn'
import {expect, it, vi} from 'vitest'

import {hardenSession, lockWebRtc} from './main'

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

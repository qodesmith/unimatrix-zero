import type {Protocol} from 'electron'

import {protocol} from 'electron'
import {readFile} from 'node:fs/promises'

import {resolveBundleFile} from './bundle-file'
import {renderCsp} from './csp'

const APP_SCHEME = 'app'
const APP_DEV_SCHEME = 'app-dev'
const APP_HOST = 'unimatrix-zero'

/** Must run before `app.whenReady()`. */
export function registerAppSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        codeCache: true,
      },
    },
    {
      scheme: APP_DEV_SCHEME,
      privileges: {standard: true, secure: true, supportFetchAPI: true},
    },
  ])
}

const securityHeaders = (csp: string) => ({
  'Content-Security-Policy': csp,
  'X-Content-Type-Options': 'nosniff',
})

/** `app://` serves only files from the built bundle folder. */
export function serveBundle(target: Protocol, bundleDir: string) {
  const csp = renderCsp()
  target.handle(APP_SCHEME, async request => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST || !['GET', 'HEAD'].includes(request.method)) {
      return new Response(null, {status: 403})
    }
    const file = resolveBundleFile(bundleDir, url.pathname)
    if (!file) return new Response(null, {status: 404})
    try {
      const body = await readFile(file.filePath)
      return new Response(body, {
        headers: {...securityHeaders(csp), 'Content-Type': file.mimeType},
      })
    } catch {
      return new Response(null, {status: 404})
    }
  })
  return `${APP_SCHEME}://${APP_HOST}/`
}

type DevServer = {
  port: number
  scriptNonce: string
}

/**
 * `app-dev://` proxies the Vite dev server, so the window keeps the same
 * origin rules in dev as in a packaged build and no check needs a localhost
 * exception. The HMR socket is the one thing the page reaches directly.
 */
export function proxyDevServer(target: Protocol, dev: DevServer) {
  const upstream = `http://localhost:${dev.port}`
  const csp = renderCsp({
    scriptNonce: dev.scriptNonce,
    connectSources: [hmrOrigin(dev)],
  })
  target.handle(APP_DEV_SCHEME, async request => {
    const url = new URL(request.url)
    if (url.host !== APP_HOST) return new Response(null, {status: 403})
    const response = await fetch(`${upstream}${url.pathname}${url.search}`, {
      method: request.method,
      headers: {accept: request.headers.get('accept') ?? '*/*'},
    })
    const headers = new Headers(securityHeaders(csp))
    const contentType = response.headers.get('content-type')
    if (contentType) headers.set('Content-Type', contentType)
    return new Response(response.body, {status: response.status, headers})
  })
  return `${APP_DEV_SCHEME}://${APP_HOST}/`
}

export function hmrOrigin(dev: Pick<DevServer, 'port'>) {
  return `ws://localhost:${dev.port}`
}

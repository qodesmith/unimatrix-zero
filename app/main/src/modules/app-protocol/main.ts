import type {FileLookups} from './tree-file'
import type {Protocol} from 'electron'

import {FILE_SCHEME} from '@uz/contract/attachments'
import {protocol} from 'electron'
import {readFile} from 'node:fs/promises'

import {resolveBundleFile} from './bundle-file'
import {renderCsp} from './csp'
import {
  EXTRACTOR_SCHEME,
  EXTRACTOR_URL,
  extractorFiles,
  extractorResponse,
} from './extractor-file'
import {fileSchemeResponse} from './tree-file'

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
    {
      scheme: FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        // The window fetches text and PDFs from it, cross-origin.
        corsEnabled: true,
      },
    },
    {
      scheme: EXTRACTOR_SCHEME,
      privileges: {standard: true, secure: true, supportFetchAPI: true},
    },
  ])
}

/**
 * `uzextract://` serves the extractor's bundle, and only on the extraction
 * window's session. Returns the page's URL.
 */
export function serveExtractor(target: Protocol, distDir: string) {
  const files = extractorFiles(distDir)
  target.handle(EXTRACTOR_SCHEME, async request =>
    extractorResponse(request, files)
  )

  return EXTRACTOR_URL
}

export function serveFiles(target: Protocol, lookups: FileLookups) {
  target.handle(FILE_SCHEME, async request =>
    fileSchemeResponse(request, lookups)
  )
}

export function originOf(appUrl: string) {
  const {protocol: scheme, host} = new URL(appUrl)

  return `${scheme}//${host}`
}

function securityHeaders(csp: string) {
  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
  }
}

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

interface DevServer {
  port: number
  scriptNonce: string
}

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

import fs from 'node:fs'
import {readFile} from 'node:fs/promises'
import path from 'node:path'

import {EXTRACTOR_CSP} from './csp'

export const EXTRACTOR_SCHEME = 'uzextract'

const EXTRACTOR_HOST = 'extractor'

export const EXTRACTOR_URL = `${EXTRACTOR_SCHEME}://${EXTRACTOR_HOST}/index.html`

const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.map', 'application/json'],
  ['.wasm', 'application/wasm'],
  ['.bcmap', 'application/octet-stream'],
  ['.pfb', 'application/octet-stream'],
  ['.ttf', 'font/ttf'],
  ['.icc', 'application/vnd.iccprofile'],
])

interface ExtractorFile {
  filePath: string
  mimeType: string
}

export type ExtractorFiles = ReadonlyMap<string, ExtractorFile>

const HEADERS = {
  'Content-Security-Policy': EXTRACTOR_CSP,
  'X-Content-Type-Options': 'nosniff',
}

/**
 * Every file in the extractor's bundle of a type the page loads. It is the
 * gate: `webRequest` never sees a worker's requests to a custom scheme.
 */
export function extractorFiles(distDir: string): ExtractorFiles {
  let entries: fs.Dirent[]

  try {
    entries = fs.readdirSync(distDir, {recursive: true, withFileTypes: true})
  } catch {
    return new Map()
  }

  return new Map(
    entries.flatMap(entry => {
      const mimeType = MIME_TYPES.get(path.extname(entry.name))

      if (!entry.isFile() || mimeType === undefined) return []

      const filePath = path.join(entry.parentPath, entry.name)
      const relative = path.relative(distDir, filePath).split(path.sep)

      return [[`/${relative.join('/')}`, {filePath, mimeType}]]
    })
  )
}

function refused(status: 403 | 404) {
  return new Response(null, {status, headers: HEADERS})
}

export async function extractorResponse(
  request: Request,
  files: ExtractorFiles
): Promise<Response> {
  const url = new URL(request.url)

  if (
    url.host !== EXTRACTOR_HOST ||
    !['GET', 'HEAD'].includes(request.method)
  ) {
    return refused(403)
  }

  const file = files.get(url.pathname)

  if (!file) return refused(404)

  try {
    const body = await readFile(file.filePath)

    return new Response(request.method === 'HEAD' ? null : body, {
      headers: {...HEADERS, 'Content-Type': file.mimeType},
    })
  } catch {
    return refused(404)
  }
}

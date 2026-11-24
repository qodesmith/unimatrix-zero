import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {
  EXTRACTOR_URL,
  extractorFiles,
  extractorResponse,
} from './extractor-file'

let folder: string
let dist: string

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-uzextract-'))
  dist = path.join(folder, 'dist')
  fs.mkdirSync(path.join(dist, 'assets'), {recursive: true})
  fs.mkdirSync(path.join(dist, 'cmaps'))
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html>')
  fs.writeFileSync(path.join(dist, 'assets', 'pdf.worker.mjs'), 'worker')
  fs.writeFileSync(path.join(dist, 'assets', 'openjpeg.wasm'), 'wasm')
  fs.writeFileSync(path.join(dist, 'cmaps', 'UniJIS-UTF8-H.bcmap'), 'cmap')
  fs.writeFileSync(path.join(dist, 'notes.txt'), 'not served')
  fs.writeFileSync(path.join(folder, 'secret.js'), 'outside')
})

afterEach(() => {
  fs.rmSync(folder, {recursive: true, force: true})
})

async function respond(url: string, method = 'GET') {
  return extractorResponse(new Request(url, {method}), extractorFiles(dist))
}

describe('serving the extractor', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8', '<!doctype html>'],
    ['assets/pdf.worker.mjs', 'text/javascript; charset=utf-8', 'worker'],
    ['assets/openjpeg.wasm', 'application/wasm', 'wasm'],
    ['cmaps/UniJIS-UTF8-H.bcmap', 'application/octet-stream', 'cmap'],
  ])(
    'serves %s from its bundle with its type, the page’s CSP and nosniff',
    async (file, mimeType, body) => {
      const response = await respond(new URL(file, EXTRACTOR_URL).href)

      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe(mimeType)
      expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(response.headers.get('Content-Security-Policy')).toContain(
        "default-src 'none'"
      )
      expect(await response.text()).toBe(body)
    }
  )

  it.each([
    ['a file not in the bundle', 'uzextract://extractor/missing.js'],
    [
      'a file of a type the page never loads',
      'uzextract://extractor/notes.txt',
    ],
    ['a path out of the bundle', 'uzextract://extractor/%2e%2e/secret.js'],
    ['the bundle folder itself', 'uzextract://extractor/assets'],
  ])('answers 404 for %s, with nosniff', async (_case, url) => {
    const response = await respond(url)

    expect(response.status).toBe(404)
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
  })

  it('answers 404 for a file added after the list was made', async () => {
    const files = extractorFiles(dist)
    fs.writeFileSync(path.join(dist, 'late.js'), 'late')

    const response = await extractorResponse(
      new Request('uzextract://extractor/late.js'),
      files
    )

    expect(response.status).toBe(404)
  })

  it.each([
    ['another host', 'uzextract://elsewhere/index.html', 'GET'],
    ['a POST', EXTRACTOR_URL, 'POST'],
  ])('answers 403 for %s', async (_case, url, method) => {
    expect((await respond(url, method)).status).toBe(403)
  })

  it('lists nothing when the bundle was never built', async () => {
    const response = await extractorResponse(
      new Request(EXTRACTOR_URL),
      extractorFiles(path.join(folder, 'never-built'))
    )

    expect(response.status).toBe(404)
  })
})

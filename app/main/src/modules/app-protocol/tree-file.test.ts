import type {ServedTreeFile} from './tree-file'

import {attachmentUrl} from '@uz/contract/attachments'
import {treeFileUrl} from '@uz/contract/tree-files'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {fileSchemeResponse} from './tree-file'

const APP_ORIGIN = 'app://unimatrix-zero'
const ATTACHMENT_ID = '019a0000-0000-7000-8000-000000000001'

const TEXT = 'a'.repeat(16)
const PDF = 'b'.repeat(16)
const HTML = 'c'.repeat(16)
const PNG = 'd'.repeat(16)
const SVG = 'e'.repeat(16)
const VIDEO = 'f'.repeat(16)
const DOCX = '1'.repeat(16)
const BIG_HTML = '2'.repeat(16)
const MARKDOWN = '3'.repeat(16)
const GONE = '4'.repeat(16)
const EMPTY = '5'.repeat(16)

const ids = {
  TEXT,
  PDF,
  HTML,
  PNG,
  SVG,
  VIDEO,
  DOCX,
  BIG_HTML,
  MARKDOWN,
  GONE,
  EMPTY,
}

function idOf(name: keyof typeof ids) {
  return ids[name].repeat(2)
}

let folder: string
let served: Map<string, ServedTreeFile>

function write(name: string, content: string) {
  const file = path.join(folder, name)
  fs.writeFileSync(file, content)

  return file
}

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-tree-file-'))

  function file(
    name: keyof typeof ids,
    content: string,
    preview: ServedTreeFile['preview'],
    more: Partial<ServedTreeFile> = {}
  ) {
    return [
      idOf(name),
      {
        path: write(name, content),
        preview,
        mediaType: null,
        tooLarge: false,
        ...more,
      },
    ] as const
  }

  served = new Map([
    file('TEXT', '0123456789', 'text'),
    file('PDF', '%PDF-1.7', 'pdf'),
    file('HTML', '<p>Hi</p>', 'html'),
    file('PNG', 'PNG bytes', 'image', {mediaType: 'image/png'}),
    file('SVG', '<svg/>', 'image', {mediaType: 'image/svg+xml'}),
    file('VIDEO', 'MP4 bytes', 'video', {mediaType: 'video/mp4'}),
    file('DOCX', 'PK', 'other'),
    file('BIG_HTML', '<p>Big</p>', 'html', {tooLarge: true}),
    file('MARKDOWN', '# Hi', 'markdown'),
    file('EMPTY', '', 'text'),
    [
      idOf('GONE'),
      {
        path: path.join(folder, 'gone'),
        preview: 'text',
        mediaType: null,
        tooLarge: false,
      },
    ],
  ])
  write('attachment', 'Attached')
})

afterEach(() => {
  fs.rmSync(folder, {recursive: true, force: true})
})

async function respond(url: string, init: RequestInit = {}) {
  return fileSchemeResponse(new Request(url, init), {
    attachment: id =>
      id === ATTACHMENT_ID
        ? {path: path.join(folder, 'attachment'), mediaType: 'text/plain'}
        : null,
    treeFile: async id => served.get(id) ?? null,
    appOrigin: APP_ORIGIN,
  })
}

async function ranged(name: keyof typeof ids, range: string) {
  return respond(treeFileUrl(idOf(name)), {headers: {Range: range}})
}

function expectLockedDown(response: Response) {
  expect(response.headers.get('Content-Security-Policy')).toBe('sandbox')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
}

describe('serving a Tree’s file by id', () => {
  it('serves the whole file, sandboxed, to the app’s window', async () => {
    const response = await respond(treeFileUrl(idOf('TEXT')))

    expect(response.status).toBe(200)
    expectLockedDown(response)
    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    )
    expect(response.headers.get('Content-Length')).toBe('10')
    expect(response.headers.get('Accept-Ranges')).toBe('bytes')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(APP_ORIGIN)
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe(
      'Content-Range, Content-Length'
    )
    expect(await response.text()).toBe('0123456789')
  })

  it.each([
    ['bytes=2-5', 'bytes 2-5/10', '2345'],
    ['bytes=7-', 'bytes 7-9/10', '789'],
    ['bytes=-3', 'bytes 7-9/10', '789'],
    ['bytes=8-100', 'bytes 8-9/10', '89'],
    ['bytes=-100', 'bytes 0-9/10', '0123456789'],
  ])('serves the range %s', async (range, contentRange, body) => {
    const response = await ranged('TEXT', range)

    expect(response.status).toBe(206)
    expectLockedDown(response)
    expect(response.headers.get('Content-Range')).toBe(contentRange)
    expect(response.headers.get('Content-Length')).toBe(String(body.length))
    expect(await response.text()).toBe(body)
  })

  it.each(['bytes=10-', 'bytes=10-12', 'bytes=-0'])(
    'answers 416 for the range %s, sandboxed',
    async range => {
      const response = await ranged('TEXT', range)

      expect(response.status).toBe(416)
      expectLockedDown(response)
      expect(response.headers.get('Content-Range')).toBe('bytes */10')
    }
  )

  it.each(['bytes=0-', 'bytes=0-262143', 'bytes=-5'])(
    'serves an empty file whole and empty for the range %s',
    async range => {
      const response = await ranged('EMPTY', range)

      expect(response.status).toBe(200)
      expectLockedDown(response)
      expect(response.headers.get('Content-Length')).toBe('0')
      expect(response.headers.get('Content-Range')).toBeNull()
      expect(await response.text()).toBe('')
    }
  )

  it.each(['bytes=0-1,4-5', 'lines=1-2', 'bytes=x-y', 'bytes=5-2'])(
    'serves the whole file for a range it doesn’t read, %s',
    async range => {
      const response = await ranged('TEXT', range)

      expect(response.status).toBe(200)
      expect(await response.text()).toBe('0123456789')
    }
  )

  it('answers HEAD with the headers alone', async () => {
    const response = await respond(treeFileUrl(idOf('TEXT')), {
      method: 'HEAD',
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('10')
    expect(await response.text()).toBe('')
  })

  it.each([
    ['a PDF', 'PDF'],
    ['a file the app doesn’t preview', 'DOCX'],
  ] as const)(
    'serves %s as bytes to download, which the window refuses, never as a document a frame shows',
    async (_case, name) => {
      const response = await respond(treeFileUrl(idOf(name)))

      expect(response.status).toBe(200)
      expectLockedDown(response)
      expect(response.headers.get('Content-Type')).toBe(
        'application/octet-stream'
      )
      expect(response.headers.get('Content-Disposition')).toBe('attachment')
    }
  )

  it.each([
    ['an image as its type', 'PNG', 'image/png'],
    ['an SVG as an image', 'SVG', 'image/svg+xml'],
    ['a video as its type', 'VIDEO', 'video/mp4'],
    ['HTML as text', 'HTML', 'text/plain; charset=utf-8'],
    ['Markdown as text', 'MARKDOWN', 'text/plain; charset=utf-8'],
  ] as const)('serves %s, sandboxed', async (_case, name, contentType) => {
    const response = await respond(treeFileUrl(idOf(name)))

    expect(response.headers.get('Content-Type')).toBe(contentType)
    expect(response.headers.get('Content-Disposition')).toBeNull()
    expectLockedDown(response)
  })

  it('serves an HTML file to run with scripts and no network at all', async () => {
    const response = await respond(treeFileUrl(idOf('HTML'), 'html'))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/html; charset=utf-8'
    )
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:"
    )
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(await response.text()).toBe('<p>Hi</p>')
  })

  it.each([
    ['a file that isn’t HTML', treeFileUrl(idOf('TEXT'), 'html')],
    [
      'an HTML file too large to preview',
      treeFileUrl(idOf('BIG_HTML'), 'html'),
    ],
    ['another view', `${treeFileUrl(idOf('HTML'))}?view=page`],
    ['an empty view', `${treeFileUrl(idOf('HTML'))}?view=`],
    ['another query', `${treeFileUrl(idOf('HTML'))}?page=1`],
    ['an id main never gave out', treeFileUrl('9'.repeat(32))],
    ['a file whose copy is gone', treeFileUrl(idOf('GONE'))],
    ['a path below the id', `${treeFileUrl(idOf('TEXT'))}/more`],
    ['no id', 'uzfile://unimatrix-zero/tree-files/'],
    ['a path', 'uzfile://unimatrix-zero/tree-files/..%2F..%2Fetc%2Fpasswd'],
  ])('answers 404 for %s, sandboxed', async (_case, url) => {
    const response = await respond(url)

    expect(response.status).toBe(404)
    expectLockedDown(response)
  })

  it.each([
    ['another host', `uzfile://elsewhere/tree-files/${idOf('TEXT')}`, 'GET'],
    ['a POST', treeFileUrl(idOf('TEXT')), 'POST'],
  ])('answers 403 for %s, sandboxed', async (_case, url, method) => {
    const response = await respond(url, {method})

    expect(response.status).toBe(403)
    expectLockedDown(response)
  })

  it('still serves attachments on the same scheme', async () => {
    const response = await respond(attachmentUrl(ATTACHMENT_ID))

    expect(response.status).toBe(200)
    expectLockedDown(response)
    expect(await response.text()).toBe('Attached')
  })
})

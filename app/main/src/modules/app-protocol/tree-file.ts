import type {OriginalLookup} from './attachment-file'
import type {TreeFilePreview} from '@uz/contract/tree-files'

import fs from 'node:fs'
import {stat} from 'node:fs/promises'
import {Readable} from 'node:stream'

import {LOCKED_DOWN, attachmentResponse} from './attachment-file'

const FILE_HOST = 'unimatrix-zero'

const TREE_FILE_PATH = /^\/tree-files\/([\da-f]{32})$/u

/** A copy of the file as its Snapshot holds it, never the Tree's folder. */
export interface ServedTreeFile {
  path: string
  preview: TreeFilePreview
  /** The image, audio or video type its name gives. */
  mediaType: string | null
  tooLarge: boolean
}

type TreeFileLookup = (id: string) => Promise<ServedTreeFile | null>

export interface FileLookups {
  attachment: OriginalLookup
  treeFile: TreeFileLookup
  /** The window's, which fetches text and PDFs from this scheme. */
  appOrigin: string
}

/** Scripts run, with nothing to reach: no network, no other file. */
const HTML_VIEW_CSP = [
  'sandbox allow-scripts',
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data:',
  'font-src data:',
  'media-src data:',
].join('; ')

const TEXT = 'text/plain; charset=utf-8'

/**
 * Never `application/pdf`: Chromium's own PDF viewer would show it in a
 * frame, and PDFs render only through pdf.js.
 */
const AS_DOWNLOAD = {
  'Content-Type': 'application/octet-stream',
  'Content-Disposition': 'attachment',
}

const AS_TEXT = {'Content-Type': TEXT}

const TYPE_HEADERS = {
  image: null,
  audio: null,
  video: null,
  markdown: AS_TEXT,
  csv: AS_TEXT,
  html: AS_TEXT,
  text: AS_TEXT,
  pdf: AS_DOWNLOAD,
  other: AS_DOWNLOAD,
} as const satisfies Record<TreeFilePreview, Record<string, string> | null>

/** Images, audio and video go as their own type; text never as a page. */
function typeHeaders({preview, mediaType}: ServedTreeFile) {
  const fixed = TYPE_HEADERS[preview]

  if (fixed) return fixed

  return mediaType ? {'Content-Type': mediaType} : AS_DOWNLOAD
}

type Range = {start: number; end: number} | 'unsatisfiable' | null

const BYTE_RANGE = /^bytes=(\d*)-(\d*)$/u

/** One range only; any other `Range` is ignored, as RFC 9110 allows. */
function rangeOf(header: string | null, size: number): Range {
  const [, first = '', last = ''] = BYTE_RANGE.exec(header?.trim() ?? '') ?? []

  if (first === '' && last === '') return null

  if (first === '') {
    const suffix = Number(last)

    return suffix === 0 || size === 0
      ? 'unsatisfiable'
      : {start: Math.max(0, size - suffix), end: size - 1}
  }

  const start = Number(first)
  const end = last === '' ? Infinity : Number(last)

  if (end < start) return null

  return start >= size ? 'unsatisfiable' : {start, end: Math.min(end, size - 1)}
}

function bodyOf(request: Request, file: string, start: number, end: number) {
  if (request.method === 'HEAD' || end < start) return null

  return Readable.toWeb(fs.createReadStream(file, {start, end}))
}

function viewOf(url: URL, served: ServedTreeFile) {
  const view = url.searchParams.get('view')

  if (view === null && url.search === '') return 'file'

  return view === 'html' && served.preview === 'html' && !served.tooLarge
    ? 'html'
    : null
}

async function treeFileResponse(
  request: Request,
  url: URL,
  {treeFile, appOrigin}: Pick<FileLookups, 'treeFile' | 'appOrigin'>
): Promise<Response> {
  const cors = {
    'Access-Control-Allow-Origin': appOrigin,
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length',
  }

  function refused(status: 404 | 416, more: Record<string, string> = {}) {
    return new Response(null, {
      status,
      headers: {...LOCKED_DOWN, ...cors, ...more},
    })
  }

  const id = TREE_FILE_PATH.exec(url.pathname)?.[1]
  const served = id === undefined ? null : await treeFile(id).catch(() => null)
  const view = served && viewOf(url, served)
  const copy = served && (await stat(served.path).catch(() => null))

  if (!served || !view || !copy) return refused(404)

  const {size} = copy

  const range = rangeOf(request.headers.get('Range'), size)

  if (range === 'unsatisfiable') {
    return refused(416, {'Content-Range': `bytes */${size}`})
  }

  const {start, end} = range ?? {start: 0, end: size - 1}

  const headers = {
    ...LOCKED_DOWN,
    ...cors,
    ...(view === 'html'
      ? {
          'Content-Security-Policy': HTML_VIEW_CSP,
          'Content-Type': 'text/html; charset=utf-8',
        }
      : typeHeaders(served)),
    'Accept-Ranges': 'bytes',
    'Content-Length': String(end - start + 1),
    ...(range && {'Content-Range': `bytes ${start}-${end}/${size}`}),
  }

  return new Response(bodyOf(request, served.path, start, end), {
    status: range ? 206 : 200,
    headers,
  })
}

/** `uzfile://` serves attachments and the Tree's files, by id (ADR 0014). */
export async function fileSchemeResponse(
  request: Request,
  lookups: FileLookups
): Promise<Response> {
  const url = new URL(request.url)

  if (
    url.host === FILE_HOST &&
    ['GET', 'HEAD'].includes(request.method) &&
    url.pathname.startsWith('/tree-files/')
  ) {
    return treeFileResponse(request, url, lookups)
  }

  return attachmentResponse(request, lookups.attachment)
}

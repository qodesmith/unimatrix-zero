import type {AttachmentMediaType} from '@uz/contract/attachments'

import {readFile} from 'node:fs/promises'

const ATTACHMENT_HOST = 'unimatrix-zero'

interface Original {
  path: string
  mediaType: AttachmentMediaType
}

export type OriginalLookup = (id: string) => Original | null

const ATTACHMENT_PATH = /^\/attachments\/([\da-f-]{36})$/u

/** On every response, so nothing served ever runs as a page (ADR 0014). */
const LOCKED_DOWN = {
  'Content-Security-Policy': 'sandbox',
  'X-Content-Type-Options': 'nosniff',
}

function refused(status: 403 | 404) {
  return new Response(null, {status, headers: LOCKED_DOWN})
}

function contentType(mediaType: AttachmentMediaType) {
  return mediaType === 'text/plain' ? 'text/plain; charset=utf-8' : mediaType
}

/** `uzfile://unimatrix-zero/attachments/<id>`: the original, by id alone. */
export async function attachmentResponse(
  request: Request,
  lookup: OriginalLookup
): Promise<Response> {
  const url = new URL(request.url)

  if (
    url.host !== ATTACHMENT_HOST ||
    !['GET', 'HEAD'].includes(request.method)
  ) {
    return refused(403)
  }

  const id = ATTACHMENT_PATH.exec(url.pathname)?.[1]
  const original = id === undefined ? null : lookup(id)

  if (!original) return refused(404)

  let body: Uint8Array

  try {
    body = await readFile(original.path)
  } catch {
    return refused(404)
  }

  return new Response(request.method === 'HEAD' ? null : body, {
    headers: {
      ...LOCKED_DOWN,
      'Content-Type': contentType(original.mediaType),
      'Content-Length': String(body.byteLength),
    },
  })
}

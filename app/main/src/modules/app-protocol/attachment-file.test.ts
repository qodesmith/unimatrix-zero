import type {AttachmentMediaType} from '@uz/contract/attachments'

import {attachmentUrl} from '@uz/contract/attachments'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {attachmentResponse} from './attachment-file'

const IMAGE_ID = '019a0000-0000-7000-8000-000000000001'
const TEXT_ID = '019a0000-0000-7000-8000-000000000002'
const GONE_ID = '019a0000-0000-7000-8000-000000000003'

let folder: string
let originals: Map<string, {path: string; mediaType: AttachmentMediaType}>

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-uzfile-'))
  fs.writeFileSync(path.join(folder, 'image'), 'PNG bytes')
  fs.writeFileSync(path.join(folder, 'text'), 'Hello')
  originals = new Map([
    [IMAGE_ID, {path: path.join(folder, 'image'), mediaType: 'image/png'}],
    [TEXT_ID, {path: path.join(folder, 'text'), mediaType: 'text/plain'}],
    [GONE_ID, {path: path.join(folder, 'gone'), mediaType: 'image/png'}],
  ])
})

afterEach(() => {
  fs.rmSync(folder, {recursive: true, force: true})
})

async function respond(url: string, method = 'GET') {
  return attachmentResponse(
    new Request(url, {method}),
    id => originals.get(id) ?? null
  )
}

function expectLockedDown(response: Response) {
  expect(response.headers.get('Content-Security-Policy')).toBe('sandbox')
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
}

describe('serving an attachment by id', () => {
  it('serves the original with the type read from its bytes, sandboxed', async () => {
    const response = await respond(attachmentUrl(IMAGE_ID))

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expectLockedDown(response)
    expect(await response.text()).toBe('PNG bytes')
  })

  it('serves a text file as UTF-8 text', async () => {
    const response = await respond(attachmentUrl(TEXT_ID))

    expect(response.headers.get('Content-Type')).toBe(
      'text/plain; charset=utf-8'
    )
    expect(await response.text()).toBe('Hello')
  })

  it('answers HEAD with the headers alone', async () => {
    const response = await respond(attachmentUrl(TEXT_ID), 'HEAD')

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Length')).toBe('5')
    expect(await response.text()).toBe('')
  })

  it.each([
    ['an id main never gave out', attachmentUrl(crypto.randomUUID())],
    ['an attachment whose file is gone', attachmentUrl(GONE_ID)],
    ['another folder', `uzfile://unimatrix-zero/workspaces/${IMAGE_ID}`],
    ['a path below the id', `${attachmentUrl(IMAGE_ID)}/more`],
    ['no id', 'uzfile://unimatrix-zero/attachments/'],
  ])('answers 404 for %s, sandboxed', async (_case, url) => {
    const response = await respond(url)

    expect(response.status).toBe(404)
    expectLockedDown(response)
  })

  it.each([
    ['another host', `uzfile://elsewhere/attachments/${IMAGE_ID}`, 'GET'],
    ['a POST', attachmentUrl(IMAGE_ID), 'POST'],
  ])('answers 403 for %s, sandboxed', async (_case, url, method) => {
    const response = await respond(url, method)

    expect(response.status).toBe(403)
    expectLockedDown(response)
  })
})

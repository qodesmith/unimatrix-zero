import type {Database} from '#modules/database/main'

import {openDatabase} from '#modules/database/main'
import {ATTACHMENT_SIZE_LIMIT} from '@uz/contract/attachments'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {createAttachments} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
])

let folder: string
let dir: string
let db: Database
let dropped: Map<string, string>
let attachments: ReturnType<typeof createAttachments>

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-attachments-'))
  dir = path.join(folder, 'attachments')
  db = openDatabase({file: ':memory:', migrationsFolder})
  dropped = new Map()
  attachments = createAttachments({
    db,
    dir,
    droppedPath: fileId => dropped.get(fileId) ?? null,
  })
})

afterEach(() => {
  db.$client.close()
  fs.rmSync(folder, {recursive: true, force: true})
})

function bytesOf(text: string) {
  return new TextEncoder().encode(text)
}

async function paste(name: string, bytes: Uint8Array<ArrayBuffer>) {
  return attachments.add({type: 'pasted', name, bytes})
}

function originalOf(id: string) {
  const original = attachments.original(id)

  if (!original) throw new Error('The attachment was not kept')

  return original.path
}

function drop(name: string, bytes: Uint8Array) {
  const file = path.join(folder, name)
  fs.writeFileSync(file, bytes)
  const fileId = crypto.randomUUID()
  dropped.set(fileId, file)

  return fileId
}

describe('the media type', () => {
  it.each([
    ['a PNG', PNG, 'image/png'],
    [
      'a JPEG',
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]),
      'image/jpeg',
    ],
    ['a GIF87a', bytesOf('GIF87a\u0001\u0000'), 'image/gif'],
    ['a GIF89a', bytesOf('GIF89a\u0001\u0000'), 'image/gif'],
    ['a WebP', bytesOf('RIFF$\u0000\u0000\u0000WEBPVP8 '), 'image/webp'],
    ['a PDF', bytesOf('%PDF-1.7\n%âãÏÓ\n'), 'application/pdf'],
    ['UTF-8 text', bytesOf('Grüße, “world”\n'), 'text/plain'],
  ])(
    'is read from the bytes of %s, whatever its name says',
    async (_kind, bytes, mediaType) => {
      const attachment = await paste('notes.exe', bytes)

      expect(attachment.mediaType).toBe(mediaType)
    }
  )

  it.each([
    ['bytes that are not UTF-8', Uint8Array.from([0x41, 0xc3, 0x28, 0x42])],
    ['text with a NUL byte', bytesOf('abc\u0000def')],
    [
      'a RIFF file that is not WebP',
      bytesOf('RIFF$\u0000\u0000\u0000WAVEfmt '),
    ],
  ])('refuses %s', async (_kind, bytes) => {
    await expect(paste('song.txt', bytes)).rejects.toThrow(
      'Unimatrix Zero attaches images, PDFs and text files; song.txt is none of these.'
    )
  })
})

describe('adding a file', () => {
  it('refuses an empty file', async () => {
    await expect(paste('empty.txt', new Uint8Array())).rejects.toThrow(
      'There’s nothing in empty.txt to attach.'
    )
  })

  it('refuses a dropped file over the size limit', async () => {
    const fileId = drop(
      'big.txt',
      new Uint8Array(ATTACHMENT_SIZE_LIMIT + 1).fill(0x61)
    )

    await expect(attachments.add({type: 'dropped', fileId})).rejects.toThrow(
      'Unimatrix Zero attaches files up to 20 MB; big.txt is larger.'
    )
  })

  it('takes a dropped file at exactly the size limit', async () => {
    const fileId = drop(
      'edge.txt',
      new Uint8Array(ATTACHMENT_SIZE_LIMIT).fill(0x61)
    )

    const attachment = await attachments.add({type: 'dropped', fileId})

    expect(attachment.size).toBe(ATTACHMENT_SIZE_LIMIT)
  })

  it('refuses a dropped-file id it was never given', async () => {
    await expect(
      attachments.add({type: 'dropped', fileId: crypto.randomUUID()})
    ).rejects.toThrow(
      'That file can’t be attached any more. Drop or pick it again.'
    )
  })

  it('names a dropped file by its base name, trimmed, and keeps its bytes', async () => {
    const fileId = drop(' photo.png ', PNG)

    const attachment = await attachments.add({type: 'dropped', fileId})

    expect(attachment).toEqual({
      id: expect.any(String),
      name: 'photo.png',
      mediaType: 'image/png',
      size: PNG.byteLength,
    })
    expect(fs.readFileSync(originalOf(attachment.id))).toEqual(Buffer.from(PNG))
  })

  it.each([
    [PNG, 'Pasted image.png'],
    [bytesOf('%PDF-1.4\n'), 'Pasted PDF.pdf'],
    [bytesOf('Hello'), 'Pasted text.txt'],
  ])(
    'names a pasted file that came with no name by what it is',
    async (bytes, name) => {
      const attachment = await paste('  ', bytes)

      expect(attachment.name).toBe(name)
    }
  )

  it('keeps one owner-only file, named by its SHA-256, for every add of the same bytes, each add with its own id and name', async () => {
    const sha256 =
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

    const kept = path.join(dir, sha256)

    const first = await paste('one.txt', bytesOf('abc'))
    const written = fs.statSync(kept)
    const second = await paste('two.txt', bytesOf('abc'))

    expect(second.id).not.toBe(first.id)
    expect([first.name, second.name]).toEqual(['one.txt', 'two.txt'])
    expect(originalOf(first.id)).toBe(kept)
    expect(originalOf(second.id)).toBe(kept)
    expect(fs.readdirSync(dir).toSorted()).toEqual([sha256, 'conversions'])
    expect(fs.statSync(kept).ino).toBe(written.ino)
    expect(written.mode.toString(8).slice(-3)).toBe('600')
  })
})

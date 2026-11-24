import type {Database} from '#modules/database/main'
import type {Attachment} from '@uz/contract/attachments'
import type {Prompt} from '@uz/contract/turns'

import {openDatabase} from '#modules/database/main'
import {
  ATTACHMENT_SIZE_LIMIT,
  INLINE_IMAGE_SIZE_LIMIT,
} from '@uz/contract/attachments'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {createAttachments} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
])

const ABC_SHA256 =
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

const JPEG_SHA256 =
  'fc16d7dcee9cae83ef3923222a81ccd8fe96c9d25fdb7f504d66f1011e0cd870'

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

function promptWith(attached: Attachment[]): Prompt {
  return {
    id: crypto.randomUUID(),
    treeId: crypto.randomUUID(),
    parentReplyId: null,
    text: '',
    attachments: attached,
    createdAt: '2026-11-24T12:00:00.000Z',
  }
}

async function missingOf(prompts: Prompt[]) {
  const checked = await attachments.withMissingCopies(prompts)

  return checked.map(prompt => prompt.attachments.map(a => a.missing))
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
  ])('attaches %s as a file of no known type', async (_kind, bytes) => {
    const attachment = await paste('song.wav', bytes)

    expect(attachment).toMatchObject({
      name: 'song.wav',
      mediaType: 'application/octet-stream',
      size: bytes.byteLength,
    })
    expect(fs.readFileSync(originalOf(attachment.id))).toEqual(
      Buffer.from(bytes)
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
      'Unimatrix Zero attaches files up to 50 MiB; big.txt is larger.'
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
      shrunkSize: null,
      folderPath: null,
      missing: false,
    })
    expect(fs.readFileSync(originalOf(attachment.id))).toEqual(Buffer.from(PNG))
  })

  it.each([
    [PNG, 'Pasted image.png'],
    [bytesOf('%PDF-1.4\n'), 'Pasted PDF.pdf'],
    [bytesOf('Hello'), 'Pasted text.txt'],
    [Uint8Array.from([0, 1, 2]), 'Pasted file'],
  ])(
    'names a pasted file that came with no name by what it is',
    async (bytes, name) => {
      const attachment = await paste('  ', bytes)

      expect(attachment.name).toBe(name)
    }
  )

  it('keeps the copy under the file’s own name, in a folder named by its SHA-256', async () => {
    const attachment = await paste('notes.md', bytesOf('abc'))

    const kept = path.join(dir, ABC_SHA256, 'notes.md')

    expect(originalOf(attachment.id)).toBe(kept)
    expect(fs.readFileSync(kept, 'utf8')).toBe('abc')
  })

  // Windows has no owner-only mode to read back.
  it.skipIf(process.platform === 'win32')(
    'keeps the copy readable by its owner alone',
    async () => {
      const attachment = await paste('notes.md', bytesOf('abc'))
      const kept = originalOf(attachment.id)

      expect(fs.statSync(kept).mode.toString(8).slice(-3)).toBe('600')
    }
  )

  it('gives the same bytes added under another name a second name beside the first, sharing the bytes, each add with its own id', async () => {
    const first = await paste('one.txt', bytesOf('abc'))
    const second = await paste('two.txt', bytesOf('abc'))

    expect(second.id).not.toBe(first.id)
    expect(originalOf(first.id)).toBe(path.join(dir, ABC_SHA256, 'one.txt'))
    expect(originalOf(second.id)).toBe(path.join(dir, ABC_SHA256, 'two.txt'))
    expect(fs.readFileSync(originalOf(second.id), 'utf8')).toBe('abc')
    expect(fs.statSync(originalOf(second.id)).ino).toBe(
      fs.statSync(originalOf(first.id)).ino
    )
    expect(fs.readdirSync(dir)).toEqual([ABC_SHA256])
  })

  it('keeps the first copy when the same bytes are added under the same name again', async () => {
    const first = await paste('one.txt', bytesOf('abc'))
    const written = fs.statSync(originalOf(first.id))

    const second = await paste('one.txt', bytesOf('abc'))

    expect(second.id).not.toBe(first.id)
    expect(fs.statSync(originalOf(second.id)).ino).toBe(written.ino)
    expect(fs.readdirSync(path.join(dir, ABC_SHA256))).toEqual(['one.txt'])
  })

  it.each([
    ['a path', '../../etc/passwd', 'passwd'],
    ['a Windows path', String.raw`C:\Users\me\photo.png`, 'photo.png'],
    ['control characters', 'a\u0000b\u001Fc\n.txt', 'abc.txt'],
    ['only dots', '..', 'Pasted text.txt'],
    ['one dot', '.', 'Pasted text.txt'],
  ])(
    'makes a name with %s safe for a file name, and stores the copy under it',
    async (_case, name, safe) => {
      const attachment = await paste(name, bytesOf('abc'))

      expect(attachment.name).toBe(safe)
      expect(originalOf(attachment.id)).toBe(path.join(dir, ABC_SHA256, safe))
      expect(fs.readFileSync(originalOf(attachment.id), 'utf8')).toBe('abc')
    }
  )

  it('cuts a name longer than a file system takes, keeping its extension', async () => {
    const attachment = await paste(`${'é'.repeat(200)}.tar.gz`, bytesOf('abc'))

    expect(attachment.name).toBe(`${'é'.repeat(126)}.gz`)
    expect(fs.readFileSync(originalOf(attachment.id), 'utf8')).toBe('abc')
  })
})

describe('a shrunk copy of an image', () => {
  const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])

  it('is kept beside the original, named by its own SHA-256 and type', async () => {
    const attachment = await attachments.add(
      {type: 'pasted', name: 'photo.png', bytes: PNG},
      JPEG
    )

    expect(attachment).toMatchObject({
      mediaType: 'image/png',
      size: PNG.byteLength,
      shrunkSize: JPEG.byteLength,
    })
    expect(
      fs.readFileSync(path.join(dir, 'shrunk', `${JPEG_SHA256}.jpg`))
    ).toEqual(Buffer.from(JPEG))
    expect(fs.readFileSync(originalOf(attachment.id))).toEqual(Buffer.from(PNG))
  })

  it.each([
    ['the original is not an image', bytesOf('Hello'), JPEG],
    ['it is not a PNG or JPEG', PNG, bytesOf('GIF89a\u0001\u0000')],
    [
      'it is over the size an image goes inline at',
      PNG,
      new Uint8Array(INLINE_IMAGE_SIZE_LIMIT + 1)
        .fill(0xff, 0, 3)
        .fill(0xd8, 1, 2),
    ],
  ])(
    'is ignored when %s, and the original still attaches',
    async (_case, bytes, shrunk) => {
      const attachment = await attachments.add(
        {type: 'pasted', name: 'original', bytes},
        shrunk
      )

      expect(attachment).toMatchObject({
        size: bytes.byteLength,
        shrunkSize: null,
      })
      expect(fs.existsSync(path.join(dir, 'shrunk'))).toBe(false)
    }
  )
})

describe('a dropped folder', () => {
  it('is attached as its path alone, with nothing copied and nothing to serve', async () => {
    const project = path.join(folder, 'my project')
    fs.mkdirSync(project)
    fs.writeFileSync(path.join(project, 'readme.md'), 'Hello')
    const fileId = crypto.randomUUID()
    dropped.set(fileId, `${project}/`)

    const attachment = await attachments.add({type: 'dropped', fileId})

    expect(attachment).toEqual({
      id: expect.any(String),
      name: 'my project',
      mediaType: 'inode/directory',
      size: 0,
      shrunkSize: null,
      folderPath: project,
      missing: false,
    })
    expect(fs.existsSync(dir)).toBe(false)
    expect(attachments.original(attachment.id)).toBeNull()
  })
})

describe('checking the copies of Prompts’ files', () => {
  it('marks a file whose copy is gone missing, and a file that reads, an image whose shrunk copy alone is gone, and a folder not', async () => {
    const gone = await paste('gone.txt', bytesOf('gone'))
    const kept = await paste('kept.txt', bytesOf('kept'))

    const image = await attachments.add(
      {type: 'pasted', name: 'photo.png', bytes: PNG},
      Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10])
    )

    const project = path.join(folder, 'project')
    fs.mkdirSync(project)
    const fileId = crypto.randomUUID()
    dropped.set(fileId, project)

    const folderAttachment = await attachments.add({type: 'dropped', fileId})
    fs.rmSync(originalOf(gone.id))
    fs.rmSync(path.join(dir, 'shrunk'), {recursive: true})

    expect(
      await missingOf([
        promptWith([kept, gone]),
        promptWith([image, folderAttachment]),
      ])
    ).toEqual([
      [false, true],
      [false, false],
    ])
  })

  // Windows has no owner-only mode to take away.
  it.skipIf(process.platform === 'win32')(
    'marks a file whose copy its owner can’t read missing',
    async () => {
      const locked = await paste('locked.txt', bytesOf('locked'))
      fs.chmodSync(originalOf(locked.id), 0o200)

      expect(await missingOf([promptWith([locked])])).toEqual([[true]])
    }
  )
})

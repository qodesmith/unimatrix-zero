import type {Database} from '#modules/database/main'
import type {ExtractionResult} from '#modules/extraction/main'
import type {Attachment} from '@uz/contract/attachments'
import type {Prompt} from '@uz/contract/turns'

import {openDatabase, schema} from '#modules/database/main'
import {
  ATTACHMENT_SIZE_LIMIT,
  INLINE_IMAGE_SIZE_LIMIT,
} from '@uz/contract/attachments'
import {EXTRACTOR_VERSION} from '@uz/contract/extraction'
import {eq} from 'drizzle-orm'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {attachToPrompt, createAttachments, hostAttachments} from './main'

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
let extracted: Uint8Array[]
let extractorOutput: () => Promise<ExtractionResult>

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-attachments-'))
  dir = path.join(folder, 'attachments')
  db = openDatabase({file: ':memory:', migrationsFolder})
  dropped = new Map()
  extracted = []
  extractorOutput = async () => ({type: 'unsupported'})
  attachments = createAttachments({
    db,
    dir,
    droppedPath: fileId => dropped.get(fileId) ?? null,
    extract: async bytes => {
      extracted.push(bytes)

      return extractorOutput()
    },
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

function promptOf(ids: string[]) {
  const systemPrompt = db
    .insert(schema.systemPrompts)
    .values({hash: crypto.randomUUID(), text: ''})
    .returning()
    .get()

  const tree = db
    .insert(schema.trees)
    .values({systemPromptId: systemPrompt.id})
    .returning()
    .get()

  const prompt = db
    .insert(schema.prompts)
    .values({treeId: tree.id, text: 'Read it.'})
    .returning()
    .get()

  attachToPrompt(db, prompt.id, ids)

  return prompt.id
}

function modeOf(target: string) {
  return fs.statSync(target).mode.toString(8).slice(-3)
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
      extraction: null,
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
      extraction: null,
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

describe('an Extraction', () => {
  const PDF = bytesOf('%PDF-1.7\n')

  const PDF_SHA256 =
    '0716f9264c9fe19f5d7455276107f3ddcc1d3497f63d60689a73558ae8a1bf5e'

  const PAGE = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])

  function extractedFolder(version = EXTRACTOR_VERSION) {
    return path.join(dir, 'extractions', PDF_SHA256, `v${version}`)
  }

  function readPdf(text: string): ExtractionResult {
    return {
      type: 'read',
      format: 'pdf',
      text,
      pageImages: [
        {page: 2, bytes: PAGE},
        {page: 5, bytes: PAGE},
      ],
      imagesStopped: true,
    }
  }

  const READ = {
    status: 'read',
    version: EXTRACTOR_VERSION,
    text: true,
    pageImages: [2, 5],
    imagesStopped: true,
  }

  it('is made when a PDF is added, its text and page images kept under its SHA-256 and the extractor’s version', async () => {
    extractorOutput = async () => readPdf('# Page 1\nHello')

    const attachment = await paste('report.pdf', PDF)

    expect(extracted).toEqual([PDF])
    expect(attachment.extraction).toEqual(READ)
    expect(fs.readdirSync(extractedFolder()).toSorted()).toEqual([
      'page-2.jpg',
      'page-5.jpg',
      'text.txt',
    ])
    expect(
      fs.readFileSync(path.join(extractedFolder(), 'text.txt'), 'utf8')
    ).toBe('# Page 1\nHello')
    expect(fs.readFileSync(path.join(extractedFolder(), 'page-5.jpg'))).toEqual(
      Buffer.from(PAGE)
    )
    expect(fs.readdirSync(path.join(dir, 'extractions'))).toEqual([PDF_SHA256])
  })

  // Windows has no owner-only mode to read back.
  it.skipIf(process.platform === 'win32')(
    'is readable by its owner alone',
    async () => {
      extractorOutput = async () => readPdf('Hello')

      await paste('report.pdf', PDF)

      expect(modeOf(path.join(dir, 'extractions'))).toBe('700')
      expect(modeOf(path.join(dir, 'extractions', PDF_SHA256))).toBe('700')
      expect(modeOf(extractedFolder())).toBe('700')
      expect(modeOf(path.join(extractedFolder(), 'text.txt'))).toBe('600')
      expect(modeOf(path.join(extractedFolder(), 'page-2.jpg'))).toBe('600')
    }
  )

  it('keeps no text file when the text is only whitespace', async () => {
    extractorOutput = async () => readPdf(' \n\t')

    const attachment = await paste('scan.pdf', PDF)

    expect(attachment.extraction).toEqual({...READ, text: false})
    expect(fs.readdirSync(extractedFolder()).toSorted()).toEqual([
      'page-2.jpg',
      'page-5.jpg',
    ])
  })

  it('is reused for the same bytes added again, with no second job', async () => {
    extractorOutput = async () => readPdf('Hello')
    await paste('report.pdf', PDF)

    const again = await paste('copy.pdf', PDF)

    expect(extracted).toHaveLength(1)
    expect(again.extraction).toEqual(READ)
  })

  it('is made again when the kept one is gone from disk', async () => {
    extractorOutput = async () => readPdf('Hello')
    await paste('report.pdf', PDF)
    fs.rmSync(extractedFolder(), {recursive: true})

    const again = await paste('copy.pdf', PDF)

    expect(extracted).toHaveLength(2)
    expect(again.extraction).toEqual(READ)
    expect(fs.existsSync(path.join(extractedFolder(), 'text.txt'))).toBe(true)
  })

  it('is made again when the one kept is another version’s', async () => {
    extractorOutput = async () => readPdf('Hello')
    const first = await paste('report.pdf', PDF)
    const other = EXTRACTOR_VERSION + 1
    fs.cpSync(extractedFolder(), extractedFolder(other), {recursive: true})
    db.update(schema.attachments)
      .set({extraction: {...READ, version: other}})
      .where(eq(schema.attachments.id, first.id))
      .run()

    const again = await paste('copy.pdf', PDF)

    expect(extracted).toHaveLength(2)
    expect(again.extraction).toEqual(READ)
    expect(fs.existsSync(path.join(extractedFolder(), 'text.txt'))).toBe(true)
  })

  it('takes the files an identical job put in place first', async () => {
    extractorOutput = async () => readPdf('Hello')
    const first = await paste('report.pdf', PDF)
    db.update(schema.attachments)
      .set({extraction: null})
      .where(eq(schema.attachments.id, first.id))
      .run()
    extractorOutput = async () => readPdf('Hello again')

    const again = await paste('copy.pdf', PDF)

    expect(extracted).toHaveLength(2)
    expect(again.extraction).toEqual(READ)
    expect(
      fs.readFileSync(path.join(extractedFolder(), 'text.txt'), 'utf8')
    ).toBe('Hello')
    expect(fs.readdirSync(path.join(dir, 'extractions'))).toEqual([PDF_SHA256])
  })

  it('is made again when the first one failed', async () => {
    extractorOutput = async () => ({type: 'failed'})
    await paste('report.pdf', PDF)
    extractorOutput = async () => readPdf('Hello')

    const again = await paste('copy.pdf', PDF)

    expect(extracted).toHaveLength(2)
    expect(again.extraction).toEqual(READ)
  })

  it.each([
    [
      'the job fails',
      async (): Promise<ExtractionResult> => ({type: 'failed'}),
    ],
    [
      'the extractor throws',
      async (): Promise<ExtractionResult> => {
        throw new Error('Gone')
      },
    ],
  ])(
    'is marked failed when %s, and the file still attaches with nothing extracted',
    async (_case, output) => {
      extractorOutput = output

      const attachment = await paste('report.pdf', PDF)

      expect(attachment).toMatchObject({
        name: 'report.pdf',
        extraction: {status: 'failed', version: EXTRACTOR_VERSION},
      })
      expect(fs.readFileSync(originalOf(attachment.id))).toEqual(
        Buffer.from(PDF)
      )
      expect(fs.existsSync(path.join(dir, 'extractions', PDF_SHA256))).toBe(
        false
      )
    }
  )

  it('is marked failed when its files can’t be written, and the file still attaches', async () => {
    extractorOutput = async () => readPdf('Hello')
    fs.mkdirSync(dir, {recursive: true})
    fs.writeFileSync(path.join(dir, 'extractions'), 'in the way')

    const attachment = await paste('report.pdf', PDF)

    expect(attachment.extraction).toEqual({
      status: 'failed',
      version: EXTRACTOR_VERSION,
    })
    expect(fs.readFileSync(originalOf(attachment.id))).toEqual(Buffer.from(PDF))
  })

  it('is none when the window doesn’t read the format', async () => {
    const attachment = await paste('archive.zip', bytesOf('PK\u0003\u0004rest'))

    expect(extracted).toHaveLength(1)
    expect(attachment.extraction).toBeNull()
    expect(fs.existsSync(path.join(dir, 'extractions'))).toBe(false)
  })

  it.each([
    ['a zip', bytesOf('PK\u0003\u0004rest')],
    ['an RTF', bytesOf(String.raw`{\rtf1\ansi Hello}`)],
    ['a notebook', bytesOf(' \n{"cells": [], "nbformat": 4}')],
    [
      'a notebook that starts with a byte order mark',
      bytesOf('\uFEFF{"cells": [], "nbformat": 4}'),
    ],
  ])('is tried for %s', async (_case, bytes) => {
    await paste('file', bytes)

    expect(extracted).toEqual([bytes])
  })

  it.each([
    ['text', bytesOf('Hello')],
    ['JSON that is not a notebook', bytesOf('{"cells": []}')],
    ['text that names nbformat but is not JSON', bytesOf('"nbformat": 4')],
    ['a notebook with a NUL byte', bytesOf('{"nbformat": 4}\u0000')],
    ['an image', PNG],
    ['a file of no known type', Uint8Array.from([0, 1, 2])],
  ])('is never tried for %s', async (_case, bytes) => {
    const attachment = await paste('file', bytes)

    expect(extracted).toEqual([])
    expect(attachment.extraction).toBeNull()
  })

  it('is never tried for a folder', async () => {
    const project = path.join(folder, 'project')
    fs.mkdirSync(project)
    const fileId = crypto.randomUUID()
    dropped.set(fileId, project)

    const attachment = await attachments.add({type: 'dropped', fileId})

    expect(extracted).toEqual([])
    expect(attachment.extraction).toBeNull()
  })

  async function hostOf(provider: 'claude' | 'chatgpt') {
    const attachment = await paste('report.pdf', PDF)

    const [ofPrompt] = hostAttachments(db, dir, provider, [
      promptOf([attachment.id]),
    ])

    return ofPrompt?.[0]
  }

  describe('for a Provider host', () => {
    it('gives the extracted files’ paths beside the original’s', async () => {
      extractorOutput = async () => readPdf('Hello')

      expect(await hostOf('chatgpt')).toEqual({
        name: 'report.pdf',
        path: path.join(dir, PDF_SHA256, 'report.pdf'),
        folder: false,
        inline: null,
        extraction: {
          text: path.join(extractedFolder(), 'text.txt'),
          pageImages: [
            {page: 2, path: path.join(extractedFolder(), 'page-2.jpg')},
            {page: 5, path: path.join(extractedFolder(), 'page-5.jpg')},
          ],
          imagesStopped: true,
        },
      })
    })

    it('gives no text path for an Extraction with no text', async () => {
      extractorOutput = async () => readPdf('')

      expect((await hostOf('chatgpt'))?.extraction).toMatchObject({
        text: null,
      })
    })

    it('gives none for a PDF that goes inline whole', async () => {
      extractorOutput = async () => readPdf('Hello')

      expect(await hostOf('claude')).toMatchObject({
        inline: {type: 'pdf'},
        extraction: null,
      })
    })

    it('gives none for a failed Extraction', async () => {
      extractorOutput = async () => ({type: 'failed'})

      expect((await hostOf('chatgpt'))?.extraction).toBeNull()
    })
  })
})

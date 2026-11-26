import type {Database} from '#modules/database/main'
import type {Desktop} from './main'
import type {TreeFileOpenWith} from '@uz/contract/commands'
import type {HostCommand} from '@uz/contract/host'
import type {TreeFile} from '@uz/contract/tree-files'

import {openDatabase} from '#modules/database/main'
import {createTrees} from '#modules/trees/main'
import {createTurns} from '#modules/turns/main'
import {DEFAULT_TREE_TOOLS} from '@uz/contract/tools'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, inject, it} from 'vitest'

import {createTreeFiles} from './main'
import {PREVIEW_SIZE_LIMIT} from './preview'
import {removeFolder} from './test-cleanup'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

let db: Database
let userData: string
let tempDir: string
let hostCommands: HostCommand[]
let snapshots: Promise<void>[]
let treeFiles: ReturnType<typeof createTreeFiles>
let turns: ReturnType<typeof createTurns>
let treeId: string
let desktop: Desktop
let opened: {how: string; file: string; name?: string}[]

function fakeDesktop(): Desktop {
  return {
    platform: 'darwin',
    editor: () => 'Zed',
    openWithDefaultApp: async file => {
      opened.push({how: 'default-app', file})
    },
    openInBrowser: async file => {
      opened.push({how: 'browser', file})
    },
    openInEditor: async file => {
      opened.push({how: 'editor', file})
    },
    quickLook: (file, name) => {
      opened.push({how: 'quick-look', file, name})
    },
    reveal: file => {
      opened.push({how: 'reveal', file})
    },
    pickSaveFile: async () => null,
    pickFolder: async () => null,
    thumbnail: async () => null,
  }
}

beforeEach(() => {
  db = openDatabase({file: ':memory:', migrationsFolder})
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-user-data-'))
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-files-temp-'))
  hostCommands = []
  snapshots = []
  opened = []
  desktop = fakeDesktop()

  const program = inject('gitProgram')

  treeFiles = createTreeFiles({
    db,
    userData,
    tempDir,
    desktop,
    publish: () => undefined,
    onFailure: error => {
      throw error
    },
    gitProgram: () => program,
    onWaitingForGit: () => undefined,
  })

  turns = createTurns({
    db,
    publish: () => undefined,
    hosts: {
      ready: () => true,
      send: (_provider, command) => hostCommands.push(command),
    },
    vendorProgramFor: () => ({program: null, configDir: '/config'}),
    treeFolderFor: treeFiles.folderFor,
    snapshotsBefore: treeFiles.snapshotsBefore,
    compactionSettingsFor: () => ({auto: true, threshold: null}),
    permissionMode: () => 'full-access',
    listedModels: () => [],
    attachmentsDir: path.join(userData, 'attachments'),
    now: () => new Date(),
    onTurnsChanged: () => undefined,
    onReplyFinished: finished =>
      snapshots.push(treeFiles.replyFinished(finished)),
  })

  treeId = createTrees(db).create(new Date(), '', DEFAULT_TREE_TOOLS).id
})

afterEach(() => {
  removeFolder(userData)
  removeFolder(tempDir)
})

function folder() {
  return treeFiles.folderFor(treeId)
}

async function send(parentReplyId: string | null) {
  const sent = turns.sendPrompt({
    model: {provider: 'claude', model: 'fake'},
    treeId,
    parentReplyId,
    text: 'Hi',
  })

  if (!sent) throw new Error('The Reply it answers is gone')

  const replyId = sent.reply.id

  await expect
    .poll(() =>
      hostCommands.some(
        command =>
          command.type === 'reply.start' && command.request.replyId === replyId
      )
    )
    .toBe(true)

  return replyId
}

function aiWrites(name: string, content: string | Uint8Array) {
  const file = path.join(folder(), name)
  fs.mkdirSync(path.dirname(file), {recursive: true})
  fs.writeFileSync(file, content)
}

function aiDeletes(name: string) {
  fs.rmSync(path.join(folder(), name))
}

async function finish(replyId: string) {
  turns.hostEvent('claude', {
    type: 'RUN_FINISHED',
    status: 'complete',
    treeId,
    replyId,
  })
  await Promise.all(snapshots)
}

/** A Reply that writes `files`, then finishes. */
async function replyWriting(
  parentReplyId: string | null,
  files: Record<string, string | Uint8Array>
) {
  const replyId = await send(parentReplyId)

  for (const [name, content] of Object.entries(files)) aiWrites(name, content)

  await finish(replyId)

  return replyId
}

async function listed(replyId: string) {
  const list = await treeFiles.listFiles(treeId, replyId)

  if (!list) throw new Error('Not found')

  return list
}

function pathsSizesAndChanges(files: TreeFile[]) {
  return files.map(({path: filePath, size, change}) => ({
    path: filePath,
    size,
    change,
  }))
}

describe('listing a Reply’s files', () => {
  it('lists the Reply’s Snapshot, with what it did to each file and the files it deleted', async () => {
    const first = await replyWriting(null, {
      'a.txt': 'one',
      'notes/b.md': 'two',
      'c.txt': 'three',
    })

    const second = await send(first)
    aiWrites('a.txt', 'one more')
    aiWrites('d.txt', 'four')
    aiDeletes('c.txt')
    await finish(second)

    expect(pathsSizesAndChanges((await listed(second)).files)).toEqual([
      {path: 'a.txt', size: 8, change: 'edited'},
      {path: 'c.txt', size: 5, change: 'deleted'},
      {path: 'd.txt', size: 4, change: 'created'},
      {path: 'notes/b.md', size: 3, change: null},
    ])
    expect(pathsSizesAndChanges((await listed(first)).files)).toEqual([
      {path: 'a.txt', size: 3, change: 'created'},
      {path: 'c.txt', size: 5, change: 'created'},
      {path: 'notes/b.md', size: 3, change: 'created'},
    ])
  })

  it('lists the nearest Snapshot above a Reply that has none yet, as the files stood, and says it isn’t in the Tree’s folder', async () => {
    const first = await replyWriting(null, {'a.txt': 'one'})
    const streaming = await send(first)
    aiWrites('b.txt', 'two')

    expect(await listed(streaming)).toMatchObject({
      files: [{path: 'a.txt', size: 3, change: null}],
      onDisk: false,
    })
  })

  it('says only the newest Reply’s files are in the Tree’s folder, once it ends', async () => {
    const first = await replyWriting(null, {'a.txt': 'one'})

    expect((await listed(first)).onDisk).toBe(true)

    const second = await send(first)

    expect((await listed(first)).onDisk).toBe(false)

    await finish(second)

    expect((await listed(first)).onDisk).toBe(false)
    expect((await listed(second)).onDisk).toBe(true)
  })

  it('lists no files for a Tree whose AI never wrote one', async () => {
    const replyId = await send(null)
    await finish(replyId)

    expect(await listed(replyId)).toEqual({files: [], onDisk: true})
  })

  it('gives the same file at the same Reply the same id, and another Reply’s another', async () => {
    const first = await replyWriting(null, {'a.txt': 'one'})
    const second = await replyWriting(first, {'b.txt': 'two'})

    const [atFirst] = (await listed(first)).files
    const [again] = (await listed(first)).files
    const [atSecond] = (await listed(second)).files

    expect(again?.id).toBe(atFirst?.id)
    expect(atSecond?.path).toBe('a.txt')
    expect(atSecond?.id).not.toBe(atFirst?.id)
  })

  it('finds nothing for a Reply the Tree doesn’t have', async () => {
    const replyId = await replyWriting(null, {'a.txt': 'one'})
    const otherTree = createTrees(db).create(new Date(), '', DEFAULT_TREE_TOOLS)

    expect(await treeFiles.listFiles(otherTree.id, replyId)).toBeNull()
    expect(await treeFiles.listFiles(treeId, crypto.randomUUID())).toBeNull()
  })
})

const BINARY = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x00, 0x1a])

async function fileAt(replyId: string, filePath: string) {
  const file = (await listed(replyId)).files.find(
    entry => entry.path === filePath
  )

  if (!file) throw new Error(`${filePath} isn’t listed`)

  return file
}

async function described(replyId: string, filePath: string) {
  const {id} = await fileAt(replyId, filePath)
  const details = await treeFiles.describeFile(id)

  if (!details) throw new Error('Not found')

  return details
}

describe('describing a file', () => {
  it.each([
    ['an image by its name, from binary bytes', 'photo.png', BINARY, 'image'],
    [
      'an SVG, which is text, as an image',
      'logo.svg',
      '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'image',
    ],
    ['audio', 'song.mp3', BINARY, 'audio'],
    ['video', 'clip.mp4', BINARY, 'video'],
    ['a PDF by its bytes', 'paper.pdf', '%PDF-1.7\n\0binary', 'pdf'],
    [
      'a PDF by its bytes whatever its name',
      'paper.bin',
      '%PDF-1.4\n\0',
      'pdf',
    ],
    ['Markdown', 'notes.md', '# Notes', 'markdown'],
    ['CSV', 'data.csv', 'a,b\n1,2', 'csv'],
    ['TSV as CSV', 'data.tsv', 'a\tb', 'csv'],
    ['HTML', 'page.html', '<p>Hi</p>', 'html'],
    ['code as text', 'app.py', 'print("hi")', 'text'],
    ['text with no extension', 'LICENSE', 'MIT', 'text'],
    ['text named as an image as text', 'fake.png', 'not an image', 'text'],
    ['an empty file as text', 'empty.txt', '', 'text'],
    ['binary bytes as other', 'blob.dat', BINARY, 'other'],
    ['binary bytes named as Markdown as other', 'odd.md', BINARY, 'other'],
    [
      'bytes that aren’t UTF-8 as other',
      'latin.txt',
      new Uint8Array([0x63, 0x61, 0x66, 0xe9, 0x21]),
      'other',
    ],
  ])('previews %s', async (_case, name, content, preview) => {
    const replyId = await replyWriting(null, {[name]: content})

    expect(await described(replyId, name)).toMatchObject({
      path: name,
      preview,
      tooLarge: false,
      link: false,
    })
  })

  it('previews text whose start ends inside a character as text', async () => {
    const text = `${'a'.repeat(8191)}é and more`
    const replyId = await replyWriting(null, {'long.txt': text})

    expect((await described(replyId, 'long.txt')).preview).toBe('text')
  })

  it('previews a link as other, never following it', async () => {
    const replyId = await send(null)
    aiWrites('target.txt', 'hidden')
    fs.symlinkSync('target.txt', path.join(folder(), 'link.txt'))
    await finish(replyId)

    expect(await described(replyId, 'link.txt')).toMatchObject({
      preview: 'other',
      link: true,
      quickLook: false,
      editor: null,
    })
  })

  it('says the app won’t open a program, or a file that isn’t a document, and calls a file that is both a program', async () => {
    const replyId = await send(null)
    aiWrites('run.sh', 'echo hi')
    fs.chmodSync(path.join(folder(), 'run.sh'), 0o755)
    aiWrites('notes.docx', 'not really')
    fs.chmodSync(path.join(folder(), 'notes.docx'), 0o755)
    aiWrites('start.bat', 'echo hi')
    aiWrites('report.docx', BINARY)
    await finish(replyId)

    expect(await described(replyId, 'run.sh')).toMatchObject({
      preview: 'text',
      notOpened: 'program',
    })
    expect((await described(replyId, 'notes.docx')).notOpened).toBe('program')
    expect((await described(replyId, 'start.bat')).notOpened).toBe(
      'not-a-document'
    )
    expect((await described(replyId, 'report.docx')).notOpened).toBeNull()
  })

  it('doesn’t preview an HTML file over its limit, but previews the start of any long text', async () => {
    const replyId = await replyWriting(null, {
      'big.html': 'x'.repeat(PREVIEW_SIZE_LIMIT.html + 1),
      'big.md': 'x'.repeat(PREVIEW_SIZE_LIMIT.html + 1),
      'limit.html': 'x'.repeat(PREVIEW_SIZE_LIMIT.html),
    })

    expect(await described(replyId, 'big.html')).toMatchObject({
      preview: 'html',
      tooLarge: true,
    })
    expect(await described(replyId, 'limit.html')).toMatchObject({
      preview: 'html',
      tooLarge: false,
    })
    expect(await described(replyId, 'big.md')).toMatchObject({
      preview: 'markdown',
      tooLarge: false,
    })
  })

  it('offers the editor and gives the modified time only for a file in the Tree’s folder', async () => {
    const first = await replyWriting(null, {'a.txt': 'one'})
    const modified = new Date('2026-11-20T10:00:00.000Z')
    fs.utimesSync(path.join(folder(), 'a.txt'), modified, modified)

    expect(await described(first, 'a.txt')).toMatchObject({
      onDisk: true,
      editor: 'Zed',
      quickLook: true,
      modified: modified.toISOString(),
    })

    const second = await replyWriting(first, {'b.txt': 'two'})

    expect(await described(first, 'a.txt')).toMatchObject({
      onDisk: false,
      editor: null,
      quickLook: true,
      modified: null,
    })
    expect((await described(second, 'a.txt')).onDisk).toBe(true)
  })

  it('describes a deleted file as it was before, never in the Tree’s folder', async () => {
    const first = await replyWriting(null, {'gone.md': '# Gone'})
    const second = await send(first)
    aiDeletes('gone.md')
    await finish(second)

    expect(await described(second, 'gone.md')).toMatchObject({
      change: 'deleted',
      size: 6,
      preview: 'markdown',
      onDisk: false,
      editor: null,
      modified: null,
    })
  })

  it('offers Quick Look only on macOS', async () => {
    desktop.platform = 'win32'
    const replyId = await replyWriting(null, {'a.docx': BINARY})

    expect(await described(replyId, 'a.docx')).toMatchObject({
      preview: 'other',
      quickLook: false,
    })
  })

  it('finds no file for an id it never listed', async () => {
    expect(await treeFiles.describeFile('0'.repeat(32))).toBeNull()
  })
})

async function servedAt(replyId: string, filePath: string) {
  const {id} = await fileAt(replyId, filePath)
  const served = await treeFiles.servedFile(id)

  if (!served) throw new Error('Not found')

  return served
}

function isReadOnly(file: string) {
  return fs.statSync(file).mode.toString(8).endsWith('444')
}

describe('serving a file to the window', () => {
  it('serves the bytes its Snapshot holds from a read-only copy in main’s own folder, never the Tree’s folder', async () => {
    const replyId = await replyWriting(null, {'photo.png': BINARY})
    aiWrites('photo.png', 'changed since')

    const served = await servedAt(replyId, 'photo.png')

    expect(served).toMatchObject({
      preview: 'image',
      mediaType: 'image/png',
      tooLarge: false,
    })
    expect(served.path.startsWith(`${tempDir}${path.sep}`)).toBe(true)
    expect(new Uint8Array(fs.readFileSync(served.path))).toEqual(BINARY)
    expect(isReadOnly(served.path)).toBe(true)
  })

  it('serves a deleted file as it was before the Reply deleted it', async () => {
    const first = await replyWriting(null, {'gone.txt': 'was here'})
    const second = await send(first)
    aiDeletes('gone.txt')
    await finish(second)

    const served = await servedAt(second, 'gone.txt')

    expect(fs.readFileSync(served.path, 'utf8')).toBe('was here')
  })

  it('writes the copy again where a link or a folder stands in its place', async () => {
    const replyId = await replyWriting(null, {'a.txt': 'mine'})
    const copy = (await servedAt(replyId, 'a.txt')).path

    for (const stand of [
      () => fs.symlinkSync(path.join(outside('a.txt'), 'a.txt'), copy),
      () => fs.mkdirSync(copy),
    ]) {
      fs.rmSync(copy, {force: true})
      stand()

      const served = await servedAt(replyId, 'a.txt')

      expect(served.path).toBe(copy)
      expect(fs.lstatSync(copy).isFile()).toBe(true)
      expect(fs.readFileSync(copy, 'utf8')).toBe('mine')
    }
  })

  it('serves nothing for an id it never listed', async () => {
    expect(await treeFiles.servedFile('0'.repeat(32))).toBeNull()
  })
})

const PROGRAM = /marked as a program, which Unimatrix Zero never opens/u
const NOT_A_DOCUMENT = /opens only documents/u

async function open(replyId: string, filePath: string, how: TreeFileOpenWith) {
  const {id} = await fileAt(replyId, filePath)

  return treeFiles.openFile(id, how)
}

async function reveal(replyId: string, filePath: string) {
  const {id} = await fileAt(replyId, filePath)

  return treeFiles.revealFile(id)
}

function inFolder(filePath: string) {
  return fs.realpathSync(path.join(folder(), filePath))
}

/** A folder outside the Tree's, holding `name`. */
function outside(name: string) {
  const elsewhere = fs.mkdtempSync(path.join(userData, 'elsewhere-'))
  fs.writeFileSync(path.join(elsewhere, name), 'secret')

  return elsewhere
}

describe('opening a file', () => {
  it('opens the file in the Tree’s folder when its Reply is the newest', async () => {
    const replyId = await replyWriting(null, {'notes/a.docx': BINARY})

    expect(await open(replyId, 'notes/a.docx', 'default-app')).toBe(true)
    expect(await open(replyId, 'notes/a.docx', 'editor')).toBe(true)
    expect(opened).toEqual([
      {how: 'default-app', file: inFolder('notes/a.docx')},
      {how: 'editor', file: inFolder('notes/a.docx')},
    ])
  })

  it('opens a read-only copy named as the file at an earlier Turn, as the file was then', async () => {
    const first = await replyWriting(null, {'notes/a.txt': 'then'})
    await replyWriting(first, {'notes/a.txt': 'now'})

    await open(first, 'notes/a.txt', 'default-app')

    const file = opened[0]?.file ?? ''

    expect(path.basename(file)).toBe('a.txt')
    expect(file.startsWith(`${tempDir}${path.sep}`)).toBe(true)
    expect(fs.readFileSync(file, 'utf8')).toBe('then')
    expect(isReadOnly(file)).toBe(true)
  })

  it('opens a deleted file from a copy of it as it was', async () => {
    const first = await replyWriting(null, {'gone.txt': 'was here'})
    const second = await send(first)
    aiDeletes('gone.txt')
    await finish(second)

    await open(second, 'gone.txt', 'default-app')

    expect(fs.readFileSync(opened[0]?.file ?? '', 'utf8')).toBe('was here')
  })

  it('never opens a program, in its app or the browser, at any Turn', async () => {
    const first = await send(null)
    aiWrites('run.html', '<script></script>')
    fs.chmodSync(path.join(folder(), 'run.html'), 0o755)
    await finish(first)

    await expect(open(first, 'run.html', 'default-app')).rejects.toThrow(
      PROGRAM
    )
    await expect(open(first, 'run.html', 'browser')).rejects.toThrow(PROGRAM)

    await replyWriting(first, {'other.txt': 'x'})

    await expect(open(first, 'run.html', 'default-app')).rejects.toThrow(
      PROGRAM
    )
    await expect(open(first, 'run.html', 'browser')).rejects.toThrow(PROGRAM)
    expect(opened).toEqual([])
  })

  it.each([
    'start.bat',
    'start.cmd',
    'setup.ps1',
    'shortcut.lnk',
    'tool.exe',
    'page.hta',
    'script.vbs',
    'script.js',
    'shell.terminal',
    'run.command',
    'place.fileloc',
    'site.webloc',
    'tool.jar',
    'Tool.app',
    'setup.pkg',
  ])(
    'never opens %s, which can run with no execute bit, with its app or the browser, at any Turn',
    async name => {
      const first = await replyWriting(null, {[name]: 'echo hi'})

      await expect(open(first, name, 'default-app')).rejects.toThrow(
        NOT_A_DOCUMENT
      )
      await expect(open(first, name, 'browser')).rejects.toThrow(
        /Only an HTML file/u
      )

      await replyWriting(first, {'other.txt': 'x'})

      await expect(open(first, name, 'default-app')).rejects.toThrow(
        NOT_A_DOCUMENT
      )
      expect(opened).toEqual([])
    }
  )

  it('opens a file that isn’t a document only where it never runs: the editor and Quick Look', async () => {
    const replyId = await replyWriting(null, {'start.bat': 'echo hi'})

    await open(replyId, 'start.bat', 'editor')
    await open(replyId, 'start.bat', 'quick-look')

    expect(opened).toEqual([
      {how: 'editor', file: inFolder('start.bat')},
      {how: 'quick-look', file: inFolder('start.bat'), name: 'start.bat'},
    ])
  })

  it.each([
    'letter.docx',
    'sheet.xlsx',
    'deck.key',
    'notes.odt',
    'paper.pdf',
    'photo.heic',
    'scan.tiff',
    'art.psd',
    'song.mp3',
    'clip.mov',
    'design.sketch',
    'notes.md',
    'data.csv',
    'page.html',
  ])('opens the document %s with its app', async name => {
    const replyId = await replyWriting(null, {[name]: BINARY})

    expect(await open(replyId, name, 'default-app')).toBe(true)
    expect(opened).toEqual([{how: 'default-app', file: inFolder(name)}])
  })

  it('never opens a file marked as a program in the Tree’s folder since its Snapshot', async () => {
    const replyId = await replyWriting(null, {'tool.txt': 'echo hi'})
    fs.chmodSync(path.join(folder(), 'tool.txt'), 0o700)

    await expect(open(replyId, 'tool.txt', 'default-app')).rejects.toThrow(
      PROGRAM
    )
    expect(opened).toEqual([])
  })

  it('never follows a link, in the folder or from a copy', async () => {
    const replyId = await send(null)
    fs.symlinkSync(
      path.join(outside('passwd'), 'passwd'),
      path.join(folder(), 'link.txt')
    )
    await finish(replyId)

    for (const how of ['default-app', 'editor', 'quick-look'] as const) {
      await expect(open(replyId, 'link.txt', how)).rejects.toThrow(/link/u)
    }

    await expect(reveal(replyId, 'link.txt')).rejects.toThrow(/link/u)

    await replyWriting(replyId, {'b.txt': 'two'})

    for (const how of ['default-app', 'quick-look'] as const) {
      await expect(open(replyId, 'link.txt', how)).rejects.toThrow(/link/u)
    }

    expect(opened).toEqual([])
  })

  it('refuses a file whose real path leaves the Tree’s folder by a link made after its Snapshot', async () => {
    const replyId = await replyWriting(null, {'notes/a.txt': 'mine'})
    fs.rmSync(path.join(folder(), 'notes'), {recursive: true})
    fs.symlinkSync(outside('a.txt'), path.join(folder(), 'notes'))

    await expect(open(replyId, 'notes/a.txt', 'default-app')).rejects.toThrow(
      /outside the Tree’s folder/u
    )
    await expect(open(replyId, 'notes/a.txt', 'editor')).rejects.toThrow(
      /outside the Tree’s folder/u
    )
    await expect(reveal(replyId, 'notes/a.txt')).rejects.toThrow(
      /outside the Tree’s folder/u
    )
    expect(opened).toEqual([])
  })

  it('opens only an HTML file in the browser', async () => {
    const replyId = await replyWriting(null, {
      'page.html': '<p>Hi</p>',
      'notes.md': '# Hi',
    })

    await open(replyId, 'page.html', 'browser')

    await expect(open(replyId, 'notes.md', 'browser')).rejects.toThrow(
      /Only an HTML file/u
    )
    expect(opened).toEqual([{how: 'browser', file: inFolder('page.html')}])
  })

  it('opens a file in the editor only in the Tree’s folder, where edits are kept', async () => {
    const first = await replyWriting(null, {'a.txt': 'one'})
    await replyWriting(first, {'b.txt': 'two'})

    await expect(open(first, 'a.txt', 'editor')).rejects.toThrow(
      /Tree’s folder/u
    )
    expect(opened).toEqual([])
  })

  it('shows a file in Quick Look with its name, on macOS only', async () => {
    const replyId = await replyWriting(null, {'report.docx': BINARY})

    await open(replyId, 'report.docx', 'quick-look')

    expect(opened).toEqual([
      {how: 'quick-look', file: inFolder('report.docx'), name: 'report.docx'},
    ])

    desktop.platform = 'linux'

    await expect(open(replyId, 'report.docx', 'quick-look')).rejects.toThrow(
      /macOS/u
    )
  })

  it('reveals a file only in the Tree’s folder', async () => {
    const first = await replyWriting(null, {'notes/a.txt': 'one'})

    await reveal(first, 'notes/a.txt')

    expect(opened).toEqual([{how: 'reveal', file: inFolder('notes/a.txt')}])

    await replyWriting(first, {'b.txt': 'two'})

    await expect(reveal(first, 'notes/a.txt')).rejects.toThrow(/Tree’s folder/u)
  })

  it('tells the user a file is no longer in the Tree’s folder', async () => {
    const replyId = await replyWriting(null, {'a.txt': 'one'})
    aiDeletes('a.txt')

    await expect(open(replyId, 'a.txt', 'default-app')).rejects.toThrow(
      'That file is no longer in the Tree’s folder.'
    )
  })

  it('finds nothing to open for an id it never listed', async () => {
    expect(await treeFiles.openFile('0'.repeat(32), 'default-app')).toBe(false)
    expect(await treeFiles.revealFile('0'.repeat(32))).toBe(false)
  })
})

function filesUnder(root: string) {
  return fs
    .readdirSync(root, {recursive: true, withFileTypes: true})
    .filter(entry => !entry.isDirectory())
    .map(entry => {
      const file = path.join(entry.parentPath, entry.name)

      return [
        path.relative(root, file).split(path.sep).join('/'),
        entry.isSymbolicLink() ? 'a link' : fs.readFileSync(file, 'utf8'),
      ]
    })
    .toSorted(([a = ''], [b = '']) => a.localeCompare(b))
}

describe('saving a copy', () => {
  it('saves the file as its Snapshot holds it where the user picks, named as the file', async () => {
    const first = await replyWriting(null, {'notes/a.txt': 'then'})
    await replyWriting(first, {'notes/a.txt': 'now'})
    const target = path.join(userData, 'saved.txt')
    const offered: string[] = []
    desktop.pickSaveFile = async name => {
      offered.push(name)

      return target
    }

    const {id} = await fileAt(first, 'notes/a.txt')

    expect(await treeFiles.saveFileCopy(id)).toEqual({saved: true})
    expect(offered).toEqual(['a.txt'])
    expect(fs.readFileSync(target, 'utf8')).toBe('then')
  })

  it('saves nothing when the user cancels', async () => {
    const replyId = await replyWriting(null, {'a.txt': 'one'})
    const {id} = await fileAt(replyId, 'a.txt')

    expect(await treeFiles.saveFileCopy(id)).toEqual({saved: false})
    expect(await treeFiles.saveFileCopy('0'.repeat(32))).toBeNull()
  })

  it('saves every file of the Reply’s Snapshot into the empty folder the user picks, a link as the text it points to', async () => {
    const first = await replyWriting(null, {
      'a.txt': 'one',
      'notes/b.md': 'two',
      'gone.txt': 'three',
    })

    const second = await send(first)
    aiWrites('a.txt', 'one more')
    aiDeletes('gone.txt')
    fs.symlinkSync('/etc/passwd', path.join(folder(), 'link'))
    await finish(second)
    await replyWriting(second, {'later.txt': 'four'})

    const target = fs.mkdtempSync(path.join(userData, 'saved-'))
    desktop.pickFolder = async () => target

    expect(await treeFiles.saveFilesCopy(treeId, second)).toEqual({
      saved: true,
    })
    expect(filesUnder(target)).toEqual([
      ['a.txt', 'one more'],
      ['link', '/etc/passwd'],
      ['notes/b.md', 'two'],
    ])
  })

  it('refuses a folder that already holds files, and saves nothing into it', async () => {
    const replyId = await replyWriting(null, {'a.txt': 'one'})
    const target = fs.mkdtempSync(path.join(userData, 'saved-'))
    fs.writeFileSync(path.join(target, 'mine.txt'), 'mine')
    desktop.pickFolder = async () => target

    await expect(treeFiles.saveFilesCopy(treeId, replyId)).rejects.toThrow(
      /empty folder/u
    )
    expect(filesUnder(target)).toEqual([['mine.txt', 'mine']])
  })

  it('saves nothing when the user cancels, and finds no Reply the Tree doesn’t have', async () => {
    const replyId = await replyWriting(null, {'a.txt': 'one'})

    expect(await treeFiles.saveFilesCopy(treeId, replyId)).toEqual({
      saved: false,
    })
    expect(
      await treeFiles.saveFilesCopy(treeId, crypto.randomUUID())
    ).toBeNull()
  })
})

describe('the OS’s thumbnail', () => {
  it('asks macOS for the thumbnail of the file as its Snapshot holds it, never the Tree’s folder', async () => {
    const asked: string[] = []
    desktop.thumbnail = async file => {
      asked.push(fs.readFileSync(file, 'utf8'))

      return 'data:image/png;base64,AAAA'
    }

    const first = await replyWriting(null, {'a.key': 'then'})
    const second = await replyWriting(first, {'a.key': 'now'})
    aiWrites('a.key', 'edited since')

    const earlier = await fileAt(first, 'a.key')
    const newest = await fileAt(second, 'a.key')

    expect(await treeFiles.thumbnail(earlier.id)).toEqual({
      dataUrl: 'data:image/png;base64,AAAA',
    })
    expect(await treeFiles.thumbnail(newest.id)).toEqual({
      dataUrl: 'data:image/png;base64,AAAA',
    })
    expect(asked).toEqual(['then', 'now'])
  })

  it('gives none off macOS, for a link, or when the OS has none', async () => {
    let asked = 0
    desktop.thumbnail = async () => {
      asked += 1
      throw new Error('No thumbnail')
    }

    const replyId = await send(null)
    aiWrites('a.key', 'one')
    fs.symlinkSync('a.key', path.join(folder(), 'link.key'))
    await finish(replyId)

    const {id} = await fileAt(replyId, 'a.key')
    const link = await fileAt(replyId, 'link.key')

    expect(await treeFiles.thumbnail(id)).toEqual({dataUrl: null})
    expect(asked).toBe(1)
    expect(await treeFiles.thumbnail(link.id)).toEqual({dataUrl: null})

    desktop.platform = 'win32'

    expect(await treeFiles.thumbnail(id)).toEqual({dataUrl: null})
    expect(asked).toBe(1)
  })
})

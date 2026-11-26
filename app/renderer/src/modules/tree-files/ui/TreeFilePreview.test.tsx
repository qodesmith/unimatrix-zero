/// <reference types="@vitest/browser-playwright" />
import type {PdfFile} from '../pdf'
import type {TreeFileDetails} from '@uz/contract/tree-files'
import type {ReactNode} from 'react'

import {TooltipProvider} from '#shadcn/ui/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {treeFileUrl} from '@uz/contract/tree-files'
import {useEffect} from 'react'
import {afterEach, expect, it, onTestFinished, vi} from 'vitest'
import {render} from 'vitest-browser-react'
import {page} from 'vitest/browser'

import {fakeMain, fileDetails, replyId, treeId} from '../fake-main'
import {PdfOpener} from '../pdf'
import {TEXT_PREVIEW_BYTES} from '../preview-queries'
import {useOpenTreeFile} from '../use-tree-files'
import {TreeFilePreview} from './TreeFilePreview'
import {TreeFilesProvider} from './TreeFilesProvider'

afterEach(() => {
  vi.restoreAllMocks()
})

function Opened({path}: {path: string}) {
  const open = useOpenTreeFile()

  useEffect(() => open({treeId, replyId, path}), [open, path])

  return null
}

const openPdf = vi.fn<(url: string) => Promise<PdfFile>>()

function Providers({children}: {children: ReactNode}) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <PdfOpener value={openPdf}>
        <TreeFilesProvider>
          <TooltipProvider>
            <div style={{position: 'relative', height: '100vh'}}>
              {children}
            </div>
          </TooltipProvider>
        </TreeFilesProvider>
      </PdfOpener>
    </QueryClientProvider>
  )
}

type Options = Omit<Parameters<typeof fakeMain>[0], 'file'>

async function renderPreview(file: TreeFileDetails, options: Options = {}) {
  const main = fakeMain({file, ...options})
  globalThis.window.uz = main

  const screen = await render(
    <>
      <Opened path={file.path} />
      <TreeFilePreview />
    </>,
    {wrapper: Providers}
  )

  await expect
    .element(panel().getByRole('heading', {name: file.path.split('/').at(-1)}))
    .toBeVisible()

  return {main, screen}
}

function panel() {
  return page.getByRole('dialog', {name: 'File preview'})
}

function opened(main: ReturnType<typeof fakeMain>) {
  return main.sent.filter(
    command =>
      command.type !== 'tree-files.list' &&
      command.type !== 'tree-file.describe' &&
      command.type !== 'tree-file.thumbnail'
  )
}

/** The file's bytes, as `fetch` would get them over `uzfile:`. */
function served(text: string) {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async () => new Response(text))
}

function holdTrusted(event: Event) {
  if (event.isTrusted) event.stopPropagation()
}

/**
 * A real load of an unknown scheme fails; only the test's own errors get
 * through.
 */
function holdLoadErrors() {
  globalThis.addEventListener('error', holdTrusted, true)
  onTestFinished(() => {
    globalThis.removeEventListener('error', holdTrusted, true)
  })
}

function framesAndEmbeds() {
  return panel().element().querySelectorAll('iframe, embed, object')
}

it('shows an image, SVG too, only as an <img>, fit to the panel until asked for its actual size', async () => {
  const file = fileDetails('art/logo.svg', {preview: 'image'})
  await renderPreview(file)
  const image = panel().getByRole('img', {name: 'logo.svg'})

  await expect.element(image).toHaveAttribute('src', treeFileUrl(file.id))
  expect(framesAndEmbeds()).toHaveLength(0)
  expect(getComputedStyle(image.element()).maxWidth).toBe('100%')

  await panel().getByRole('button', {name: 'Actual size'}).click()

  expect(getComputedStyle(image.element()).maxWidth).toBe('none')
})

it('plays audio with the player’s own controls', async () => {
  holdLoadErrors()
  const file = fileDetails('talk.m4a', {preview: 'audio'})
  await renderPreview(file)
  await expect
    .poll(() => panel().element().querySelector('audio'))
    .not.toBeNull()
  const audio = panel().element().querySelector('audio')

  expect(audio?.getAttribute('src')).toBe(treeFileUrl(file.id))
  expect(audio?.controls).toBe(true)
})

it('plays a video, and shows the fallback card once it can’t', async () => {
  holdLoadErrors()
  const file = fileDetails('clip.mp4', {preview: 'video', size: 2048})
  await renderPreview(file)
  await expect
    .poll(() => panel().element().querySelector('video'))
    .not.toBeNull()
  const video = panel().element().querySelector('video')

  expect(video?.getAttribute('src')).toBe(treeFileUrl(file.id))
  expect(video?.controls).toBe(true)

  video?.dispatchEvent(new Event('error'))

  const card = panel().getByRole('group', {name: 'clip.mp4'})
  await expect
    .element(card.getByText('This video can’t play here.'))
    .toBeVisible()
  await expect.element(card.getByText('MP4 file · 2 KiB')).toBeVisible()
  expect(panel().element().querySelector('video')).toBeNull()
})

it('draws a PDF’s pages through pdf.js from the file’s bytes, never in a frame', async () => {
  const drawn: number[] = []

  const pdf: PdfFile = {
    pageCount: 3,
    firstPageRatio: 1.3,
    drawPage: async (number, _canvas, width) => {
      if (width > 0) drawn.push(number)
    },
    close: vi.fn<() => void>(),
  }

  openPdf.mockResolvedValue(pdf)
  const file = fileDetails('report.pdf', {preview: 'pdf'})
  const {screen} = await renderPreview(file)

  await expect.element(panel().getByLabelText('Page 3')).toBeInTheDocument()
  expect(openPdf).toHaveBeenCalledWith(treeFileUrl(file.id))
  await expect.poll(() => drawn).toContain(1)
  expect(framesAndEmbeds()).toHaveLength(0)

  await screen.unmount()

  expect(pdf.close).toHaveBeenCalled()
})

it('renders Markdown through the same pipeline as Replies, from the file’s start', async () => {
  const fetched = served('# Plan\n\nPack **light**.\n')
  const file = fileDetails('plan.md', {preview: 'markdown', size: 23})
  await renderPreview(file)

  await expect
    .element(panel().getByRole('heading', {name: 'Plan', level: 1}))
    .toBeVisible()
  await expect
    .element(panel().getByText('Pack light.', {exact: true}))
    .toBeVisible()
  await expect
    .element(panel().getByText('**', {exact: false}))
    .not.toBeInTheDocument()
  expect(fetched).toHaveBeenCalledWith(treeFileUrl(file.id), {
    headers: {Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}`},
  })
})

it('shows a CSV as a table, its quoted commas and newlines kept in their cells', async () => {
  served('name,city\n"Sam, Jr.","Lisbon\nPT"\nAna,Porto\n')
  const file = fileDetails('people.csv', {preview: 'csv', size: 43})
  await renderPreview(file)

  const table = panel().getByRole('table')
  await expect
    .element(table.getByRole('columnheader', {name: 'city'}))
    .toBeVisible()
  expect(
    table
      .getByRole('row')
      .elements()
      .map(row => [...row.children].map(cell => cell.textContent))
  ).toEqual([
    ['name', 'city'],
    ['Sam, Jr.', 'Lisbon\nPT'],
    ['Ana', 'Porto'],
  ])
})

it('shows a TSV split by tabs', async () => {
  served('a,1\tb\n')
  await renderPreview(fileDetails('cols.tsv', {preview: 'csv', size: 6}))

  await expect
    .element(panel().getByRole('columnheader', {name: 'a,1'}))
    .toBeVisible()
})

it('shows text as it is, in a <pre>', async () => {
  served('<b>not bold</b>\n')
  await renderPreview(fileDetails('page.txt', {preview: 'text', size: 16}))

  await expect
    .element(panel().getByText('<b>not bold</b>'))
    .toHaveProperty('tagName', 'PRE')
})

it('shows a long file’s start up to its last whole line, and opens the rest', async () => {
  const line = 'x'.repeat(99)
  const lines = Math.ceil(TEXT_PREVIEW_BYTES / 100)
  const start = `${line}\n`.repeat(lines).slice(0, TEXT_PREVIEW_BYTES)
  served(start)

  const file = fileDetails('log.txt', {size: TEXT_PREVIEW_BYTES * 4})
  const {main} = await renderPreview(file)

  const shown = start.slice(0, start.lastIndexOf('\n'))
  await expect
    .poll(() => panel().element().querySelector('pre')?.textContent)
    .toBe(shown)
  await expect
    .element(panel().getByText(/^Showing the first .* of 1 MiB\.$/))
    .toBeVisible()

  await panel().getByRole('button', {name: 'Open to see the rest'}).click()

  expect(opened(main)).toEqual([
    {type: 'tree-file.open', fileId: file.id, with: 'default-app'},
  ])
})

it('runs HTML in a frame that allows scripts and nothing more, with Open in browser beside it', async () => {
  const file = fileDetails('site/index.html', {preview: 'html'})
  const {main} = await renderPreview(file)
  await expect
    .poll(() => panel().element().querySelector('iframe'))
    .not.toBeNull()
  const frame = panel().element().querySelector('iframe')

  expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
  expect(frame?.getAttribute('src')).toBe(treeFileUrl(file.id, 'html'))

  await panel().getByRole('button', {name: 'Open in browser'}).click()

  expect(opened(main)).toEqual([
    {type: 'tree-file.open', fileId: file.id, with: 'browser'},
  ])
})

it.each([
  ['.gitkeep', 'text'],
  ['notes.md', 'markdown'],
  ['page.html', 'html'],
] as const)('says %s is empty, and reads none of it', async (name, preview) => {
  const fetched = served('')
  await renderPreview(fileDetails(name, {preview, size: 0}))

  await expect.element(panel().getByText('This file is empty.')).toBeVisible()
  expect(fetched).not.toHaveBeenCalled()
  expect(framesAndEmbeds()).toHaveLength(0)
})

it('shows the fallback card for a file too large to preview', async () => {
  const file = fileDetails('huge.png', {preview: 'image', tooLarge: true})
  await renderPreview(file)

  await expect
    .element(
      panel()
        .getByRole('group', {name: 'huge.png'})
        .getByText('Too large to preview here.')
    )
    .toBeVisible()
  await expect.element(panel().getByRole('img')).not.toBeInTheDocument()
})

it('offers Quick Look on a file only macOS can show, with its thumbnail', async () => {
  const thumbnail = 'data:image/png;base64,iVBORw0KGgo='
  const file = fileDetails('deck.key', {preview: 'other', quickLook: true})
  const {main} = await renderPreview(file, {thumbnail})

  const card = panel().getByRole('group', {name: 'deck.key'})
  await expect
    .element(card.getByText('The app can’t show this file, but macOS can.'))
    .toBeVisible()
  await expect
    .poll(() => card.element().querySelector('img')?.getAttribute('src'))
    .toBe(thumbnail)

  await card.getByRole('button', {name: 'Quick Look'}).click()

  expect(opened(main)).toEqual([
    {type: 'tree-file.open', fileId: file.id, with: 'quick-look'},
  ])
})

it('shows the fallback card, with what is known of the file, when nothing can show it', async () => {
  const file = fileDetails('data.bin', {
    preview: 'other',
    size: 3 * 1024 * 1024,
    modified: '2026-11-20T10:00:00.000Z',
  })

  const {main} = await renderPreview(file)

  const card = panel().getByRole('group', {name: 'data.bin'})
  await expect
    .element(card.getByText('The app can’t preview this type of file.'))
    .toBeVisible()
  await expect.element(card.getByText('BIN file · 3 MiB')).toBeVisible()
  await expect
    .element(
      card.getByText(
        `Modified ${new Date('2026-11-20T10:00:00.000Z').toLocaleString()}`
      )
    )
    .toBeVisible()
  await expect
    .element(card.getByRole('button', {name: 'Quick Look'}))
    .not.toBeInTheDocument()
  expect(main.sent.map(command => command.type)).not.toContain(
    'tree-file.thumbnail'
  )
})

it('says the app doesn’t follow a link', async () => {
  await renderPreview(fileDetails('latest', {preview: 'text', link: true}))

  await expect
    .element(
      panel()
        .getByRole('group', {name: 'latest'})
        .getByText(/The app doesn’t follow links\.$/)
    )
    .toBeVisible()
})

it('opens, reveals and edits a file in the Tree’s folder', async () => {
  served('hello\n')
  const file = fileDetails('notes.txt', {editor: 'Cursor', size: 6})
  const {main} = await renderPreview(file)

  await panel().getByRole('button', {name: 'Open in default app'}).click()
  await panel().getByRole('button', {name: 'Reveal in Finder'}).click()
  await panel().getByRole('button', {name: 'Open in Cursor'}).click()

  expect(opened(main)).toEqual([
    {type: 'tree-file.open', fileId: file.id, with: 'default-app'},
    {type: 'tree-file.reveal', fileId: file.id},
    {type: 'tree-file.open', fileId: file.id, with: 'editor'},
  ])
  await expect
    .element(panel().getByText('How this file looked at this Turn.'))
    .not.toBeInTheDocument()
  await expect
    .element(panel().getByRole('button', {name: 'Save a copy…'}))
    .not.toBeInTheDocument()
})

it.each([
  {fileManager: 'explorer', name: 'Show in File Explorer'},
  {fileManager: 'other', name: 'Show in folder'},
] as const)(
  'labels Reveal "$name" for the $fileManager file manager',
  async ({fileManager, name}) => {
    served('hello\n')
    const file = fileDetails('notes.txt', {fileManager})
    const {main} = await renderPreview(file)

    await panel().getByRole('button', {name}).click()

    expect(opened(main)).toEqual([{type: 'tree-file.reveal', fileId: file.id}])
    await expect
      .element(panel().getByRole('button', {name: 'Reveal in Finder'}))
      .not.toBeInTheDocument()
  }
)

it('opens or saves the version of a file at an earlier Turn, saying so', async () => {
  served('hello\n')
  const file = fileDetails('notes.txt', {onDisk: false, editor: 'Cursor'})
  const {main} = await renderPreview(file)

  await expect
    .element(panel().getByText('How this file looked at this Turn.'))
    .toBeVisible()
  await panel().getByRole('button', {name: 'Open this version'}).click()
  await panel().getByRole('button', {name: 'Save a copy…'}).click()

  expect(opened(main)).toEqual([
    {type: 'tree-file.open', fileId: file.id, with: 'default-app'},
    {type: 'tree-file.save-copy', fileId: file.id},
  ])

  for (const name of ['Reveal in Finder', 'Open in Cursor']) {
    await expect
      .element(panel().getByRole('button', {name}))
      .not.toBeInTheDocument()
  }
})

it('never opens a file marked as a program, and says so, offering Reveal in Finder', async () => {
  served('#!/bin/sh\n')
  const file = fileDetails('run.sh', {notOpened: 'program', size: 10})
  const {main} = await renderPreview(file)

  await expect
    .element(
      panel().getByText(
        'This file is marked as a program, and the app never opens programs.'
      )
    )
    .toBeVisible()
  await panel().getByRole('button', {name: 'Reveal in Finder'}).click()

  expect(opened(main)).toEqual([{type: 'tree-file.reveal', fileId: file.id}])
  expect(
    panel()
      .getByRole('button')
      .elements()
      .map(button => button.textContent)
      .filter(label => label.startsWith('Open'))
  ).toEqual([])
})

it('never opens a file that isn’t a document with its app, and says so, offering Reveal in Finder and the editor', async () => {
  served('echo hi\n')

  const file = fileDetails('start.bat', {
    notOpened: 'not-a-document',
    editor: 'Cursor',
    size: 8,
  })

  const {main} = await renderPreview(file)

  await expect
    .element(
      panel().getByText(
        'The app opens only documents, and this kind of file can run as a program.'
      )
    )
    .toBeVisible()
  await panel().getByRole('button', {name: 'Reveal in Finder'}).click()
  await panel().getByRole('button', {name: 'Open in Cursor'}).click()

  expect(opened(main)).toEqual([
    {type: 'tree-file.reveal', fileId: file.id},
    {type: 'tree-file.open', fileId: file.id, with: 'editor'},
  ])
  await expect
    .element(panel().getByRole('button', {name: 'Open in default app'}))
    .not.toBeInTheDocument()
})

it('offers only Save a copy… for a file that isn’t a document at an earlier Turn', async () => {
  served('echo hi\n')

  const file = fileDetails('start.bat', {
    notOpened: 'not-a-document',
    onDisk: false,
  })

  const {main} = await renderPreview(file)

  await expect
    .element(panel().getByText(/^The app opens only documents/))
    .toBeVisible()
  await panel().getByRole('button', {name: 'Save a copy…'}).click()

  expect(opened(main)).toEqual([{type: 'tree-file.save-copy', fileId: file.id}])
  await expect
    .element(panel().getByRole('button', {name: 'Open this version'}))
    .not.toBeInTheDocument()
})

it('offers no Open to see the rest of a long file that isn’t a document', async () => {
  served(`${'x'.repeat(99)}\n`.repeat(10))
  await renderPreview(
    fileDetails('build.log', {
      notOpened: 'not-a-document',
      size: TEXT_PREVIEW_BYTES * 4,
    })
  )

  await expect.element(panel().getByText(/^Showing the first /)).toBeVisible()
  await expect
    .element(panel().getByRole('button', {name: 'Open to see the rest'}))
    .not.toBeInTheDocument()
})

it('offers only Save a copy… for a program at an earlier Turn', async () => {
  served('#!/bin/sh\n')
  const file = fileDetails('run.sh', {notOpened: 'program', onDisk: false})
  const {main} = await renderPreview(file)

  await panel().getByRole('button', {name: 'Save a copy…'}).click()

  expect(opened(main)).toEqual([{type: 'tree-file.save-copy', fileId: file.id}])
  await expect
    .element(panel().getByRole('button', {name: 'Reveal in Finder'}))
    .not.toBeInTheDocument()
})

it('saves a copy of a deleted file as it was before, and neither opens nor reveals it', async () => {
  served('gone\n')
  const file = fileDetails('old.txt', {change: 'deleted', onDisk: false})
  const {main} = await renderPreview(file, {onDisk: true})

  await expect
    .element(
      panel().getByText('This is how it looked before this Reply deleted it.')
    )
    .toBeVisible()
  await panel().getByRole('button', {name: 'Save a copy…'}).click()

  expect(opened(main)).toEqual([{type: 'tree-file.save-copy', fileId: file.id}])

  for (const name of ['Open in default app', 'Reveal in Finder']) {
    await expect
      .element(panel().getByRole('button', {name}))
      .not.toBeInTheDocument()
  }
})

it('shows main’s refusal beside the actions', async () => {
  served('hello\n')
  await renderPreview(fileDetails('notes.txt'), {
    refuses: 'The file is gone from the folder.',
  })

  await panel().getByRole('button', {name: 'Open in default app'}).click()

  await expect
    .element(panel().getByRole('alert'))
    .toHaveTextContent('The file is gone from the folder.')
})

it('says what this Reply did to the file, its path and its size', async () => {
  served('hello\n')
  await renderPreview(
    fileDetails('docs/notes.txt', {change: 'edited', size: 2048})
  )

  await expect
    .element(panel().getByText('docs/notes.txt · 2 KiB · Edited by this Reply'))
    .toBeVisible()
})

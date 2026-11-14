import type {TestPage} from '#modules/test-pdfs/main'

import {testPdf} from '#modules/test-pdfs/main'
import {createHash} from 'node:crypto'
import {mkdir, mkdtemp, readdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {afterEach, expect, it} from 'vitest'

import {convertPdf} from './main'

const folders: string[] = []

afterEach(async () => {
  await Promise.all(
    folders.splice(0).map(async folder => rm(folder, {recursive: true}))
  )
})

async function setUp(bytes: Uint8Array, name = 'report.pdf') {
  const folder = await mkdtemp(path.join(tmpdir(), 'uz-pdf-'))
  folders.push(folder)
  const original = path.join(folder, 'original')
  await writeFile(original, bytes)

  return {
    original: {
      name,
      mediaType: 'application/pdf' as const,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      path: original,
    },
    conversionDir: path.join(folder, 'conversions'),
  }
}

async function convertPages(pages: TestPage[]) {
  const {original, conversionDir} = await setUp(testPdf(pages))

  return convertPdf(original, conversionDir)
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** The aspect ratio of a PNG, read from its header, or null for another file. */
function pngAspect(image: Uint8Array | null | undefined) {
  if (!image || PNG_SIGNATURE.some((byte, at) => image[at] !== byte))
    return null
  const header = new DataView(image.buffer, image.byteOffset)

  return header.getUint32(16) / header.getUint32(20)
}

it('sends a page with no text as a PNG of the page, with empty text', async () => {
  const [page] = await convertPages([{}])

  expect(page?.text).toBe('')
  expect(pngAspect(page?.image)).toBe(2)
})

it('sends a page of text as its text alone', async () => {
  const pages = await convertPages([{text: 'Quarterly results'}])

  expect(pages).toEqual([{text: 'Quarterly results', image: null}])
})

it('sends a page whose images cover half of it as a PNG and its text', async () => {
  const [page] = await convertPages([
    {text: 'Chart', images: [{x: 0, y: 0, w: 100, h: 100}]},
  ])

  expect(page?.text).toBe('Chart')
  expect(pngAspect(page?.image)).toBe(2)
})

it('sends a page whose images cover under a tenth of it as its text alone', async () => {
  const pages = await convertPages([
    {text: 'Logo', images: [{x: 150, y: 10, w: 10, h: 10}]},
    {text: 'Margin', images: [{x: 0, y: 0, w: 18, h: 100}]},
  ])

  expect(pages).toEqual([
    {text: 'Logo', image: null},
    {text: 'Margin', image: null},
  ])
})

it('counts only the part of an image that lies on the page', async () => {
  const pages = await convertPages([
    {text: 'Bleed', images: [{x: 190, y: 0, w: 100, h: 100}]},
  ])

  expect(pages).toEqual([{text: 'Bleed', image: null}])
})

it('reuses a cached conversion, images included, without the original', async () => {
  const {original, conversionDir} = await setUp(testPdf([{text: 'Cover'}, {}]))
  const converted = await convertPdf(original, conversionDir)
  await rm(original.path)

  const cached = await convertPdf(original, conversionDir)

  expect(cached).toEqual(converted)
  expect(pngAspect(cached[1]?.image)).toBe(2)
})

it('converts afresh over a corrupt cache, and caches that', async () => {
  const {original, conversionDir} = await setUp(testPdf([{text: 'Cover'}, {}]))
  const converted = await convertPdf(original, conversionDir)
  const files = await readdir(conversionDir, {recursive: true})
  await Promise.all(
    files.map(async file =>
      writeFile(path.join(conversionDir, file), '{"pages": [').catch(
        () => undefined
      )
    )
  )

  expect(await convertPdf(original, conversionDir)).toEqual(converted)
  await rm(original.path)
  expect(await convertPdf(original, conversionDir)).toEqual(converted)
})

it('converts afresh over a cache an older conversion wrote', async () => {
  const {original, conversionDir} = await setUp(testPdf([{text: 'Cover'}]))
  const folder = path.join(conversionDir, original.sha256)
  await mkdir(folder, {recursive: true})
  await writeFile(
    path.join(folder, 'manifest.json'),
    JSON.stringify({pages: [{text: 'Converted the old way', image: null}]})
  )

  const [page] = await convertPdf(original, conversionDir)

  expect(page?.text).toBe('Cover')
})

it('refuses a file that isn’t a PDF with a sentence naming it', async () => {
  const {original, conversionDir} = await setUp(
    new TextEncoder().encode('Not a PDF at all.'),
    'notes.pdf'
  )

  await expect(convertPdf(original, conversionDir)).rejects.toThrow(
    'Unimatrix Zero couldn’t read notes.pdf as a PDF.'
  )
})

it('refuses a password-protected PDF with a sentence naming it', async () => {
  const {original, conversionDir} = await setUp(
    testPdf([{text: 'Secret'}], {encrypted: true}),
    'payroll.pdf'
  )

  await expect(convertPdf(original, conversionDir)).rejects.toThrow(
    'payroll.pdf is password-protected, so Unimatrix Zero couldn’t read it.'
  )
})

it('caches each PDF apart from the others', async () => {
  const first = await setUp(testPdf([{text: 'First'}]))
  const second = await setUp(testPdf([{text: 'Second'}]))

  await convertPdf(first.original, first.conversionDir)
  const pages = await convertPdf(second.original, first.conversionDir)

  expect(pages).toEqual([{text: 'Second', image: null}])
})

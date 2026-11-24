import {PAGE, makeJpeg, makePdf} from '#modules/test-pdf/main'
import {beforeAll, describe, expect, it} from 'vitest'

import {readPdf} from './main'

let jpeg: Awaited<ReturnType<typeof makeJpeg>>

beforeAll(async () => {
  jpeg = await makeJpeg()
})

describe('readPdf', () => {
  it('gives each page its text under a heading', async () => {
    const pdf = makePdf(
      [{lines: ['Hello (world)', 'Second line']}, {lines: ['Page two']}],
      jpeg
    )

    const result = await readPdf(pdf)

    expect(result.text).toBe(
      '--- Page 1 ---\nHello (world)\nSecond line\n\n--- Page 2 ---\nPage two'
    )
    expect(result.pageImages).toEqual([])
    expect(result.imagesStopped).toBe(false)
  })

  it('gives a scanned page, one with no text, a JPEG 1600 px on its long side', async () => {
    const pdf = makePdf(
      [{images: [{x: 0, y: 0, ...PAGE}]}, {lines: ['Just text']}],
      jpeg
    )

    const result = await readPdf(pdf)

    expect(result.pageImages.map(({page}) => page)).toEqual([1])
    expect(await jpegSize(result.pageImages[0]?.bytes)).toEqual({
      width: 1236,
      height: 1600,
    })
    expect(result.text).toBe('--- Page 1 ---\n\n--- Page 2 ---\nJust text')
  })

  it('gives a PDF with no text on any page no text at all, not a heading per page', async () => {
    const page = {images: [{x: 0, y: 0, ...PAGE}]}
    const result = await readPdf(makePdf([page, page], jpeg))

    expect(result.text).toBe('')
    expect(result.pageImages.map(({page: number}) => number)).toEqual([1, 2])
  })

  it('gives a page an image when its images cover more than a tenth of it, counting only what lies on the page', async () => {
    const pdf = makePdf(
      [
        {
          lines: ['A page with a figure'],
          images: [{x: 72, y: 300, width: 468, height: 120}],
        },
        {
          lines: ['A page with a logo'],
          images: [{x: 500, y: 700, width: 60, height: 60}],
        },
        {
          lines: ['A page with a huge image, nearly all of it off the page'],
          images: [{x: -1940, y: -1940, width: 2000, height: 2000}],
        },
        {
          lines: ['A page with figures that are small alone, large together'],
          images: [100, 300, 500].map(y => ({
            x: 72,
            y,
            width: 468,
            height: 42,
          })),
        },
      ],
      jpeg
    )

    const result = await readPdf(pdf)

    expect(result.pageImages.map(({page}) => page)).toEqual([1, 4])
    expect(result.text).toContain('--- Page 2 ---\nA page with a logo')
  })

  it('measures an image drawn inside a form at the size the form scales it to', async () => {
    const figure = {x: 72, y: 72, width: 468, height: 240}

    const pdf = makePdf(
      [
        {
          lines: ['A figure in a form at half size'],
          images: [figure],
          formScale: 0.5,
        },
        {
          lines: ['The same figure in a form at full size'],
          images: [figure],
          formScale: 1,
        },
      ],
      jpeg
    )

    const result = await readPdf(pdf)

    expect(result.pageImages.map(({page}) => page)).toEqual([2])
  })

  it('stops page images at 100 pages, saying so, and still gives every page its text', async () => {
    const pages = Array.from({length: 103}, (_, index) => ({
      lines: [`Page ${index + 1} text`],
      images: [{x: 72, y: 72, width: 468, height: 240}],
    }))

    const result = await readPdf(makePdf(pages, jpeg))

    expect(result.pageImages.map(({page}) => page)).toEqual(
      Array.from({length: 100}, (_, index) => index + 1)
    )
    expect(result.imagesStopped).toBe(true)
    expect(
      result.text.match(/^--- Page \d+ ---\nPage \d+ text$/gm)
    ).toHaveLength(103)
    expect(result.text).toContain('--- Page 103 ---\nPage 103 text')
    expect(await jpegSize(result.pageImages.at(-1)?.bytes)).toEqual({
      width: 1236,
      height: 1600,
    })
  })

  it('does not say images stopped when the 100th image is the last one called for', async () => {
    const pages = Array.from({length: 101}, (_, index) => ({
      lines: [`Page ${index + 1} text`],
      images: index === 100 ? [] : [{x: 72, y: 72, width: 468, height: 240}],
    }))

    const result = await readPdf(makePdf(pages, jpeg))

    expect(result.pageImages).toHaveLength(100)
    expect(result.imagesStopped).toBe(false)
  })
})

async function jpegSize(bytes: Uint8Array | undefined) {
  if (!bytes) throw new Error('no image')
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff])
  const bitmap = await createImageBitmap(new Blob([bytes.slice()]))

  return {width: bitmap.width, height: bitmap.height}
}

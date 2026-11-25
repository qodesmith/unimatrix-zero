import {
  EXTRACTED_TEXT_LIMIT,
  PAGE_IMAGES_PER_PDF,
  PAGE_IMAGE_PIXELS,
} from '@uz/contract/extraction'
import {describe, expect, it} from 'vitest'

import {PAGE_IMAGE_SIZE_LIMIT, validateOutput} from './output'
import {jpegBytes, pngBytes} from './test-images'

const PDF = new TextEncoder().encode('%PDF-1.7\n')

const DOCX = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])

function text(value: string) {
  return new TextEncoder().encode(value)
}

function pdfOutput(pageImages: {page: number; bytes: Uint8Array}[]) {
  return {
    type: 'read',
    format: 'pdf',
    text: text('# Page 1\nHello'),
    pageImages,
    imagesStopped: false,
  }
}

describe('output from the extraction window', () => {
  it('passes when it is a PDF’s text and JPEG page images within the limits', () => {
    const page = jpegBytes(PAGE_IMAGE_PIXELS, 900)

    expect(validateOutput(pdfOutput([{page: 1, bytes: page}]), PDF)).toEqual({
      type: 'read',
      format: 'pdf',
      text: '# Page 1\nHello',
      pageImages: [{page: 1, bytes: page}],
      imagesStopped: false,
    })
  })

  it('passes an office file’s text with no page images', () => {
    expect(
      validateOutput(
        {
          type: 'read',
          format: 'docx',
          text: text('Grüße'),
          pageImages: [],
          imagesStopped: false,
        },
        DOCX
      )
    ).toMatchObject({type: 'read', format: 'docx', text: 'Grüße'})
  })

  it('passes “unsupported” for a zip, and turns a “failed” into a failure', () => {
    expect(validateOutput({type: 'unsupported'}, DOCX)).toEqual({
      type: 'unsupported',
    })
    expect(validateOutput({type: 'failed', message: 'Bad'}, PDF)).toEqual({
      type: 'failed',
    })
  })

  it('refuses “unsupported” for a PDF or an RTF file, whose format the bytes alone settle', () => {
    expect(validateOutput({type: 'unsupported'}, PDF)).toEqual({
      type: 'failed',
    })
    expect(validateOutput({type: 'unsupported'}, text('{\\rtf1 Hi}'))).toEqual({
      type: 'failed',
    })
  })

  it.each([
    ['null, as a transferred buffer arrives', null],
    ['a message of the wrong shape', {type: 'read', format: 'pdf'}],
    ['an unknown field', {type: 'unsupported', extra: true}],
    ['text as a string', {...pdfOutput([]), text: 'Hello'}],
    [
      'text that is not UTF-8',
      {...pdfOutput([]), text: Uint8Array.from([0x41, 0xc3, 0x28])},
    ],
    [
      'text over the cap',
      {...pdfOutput([]), text: new Uint8Array(EXTRACTED_TEXT_LIMIT + 1)},
    ],
    ['a PNG as a page image', pdfOutput([{page: 1, bytes: pngBytes()}])],
    [
      'a JPEG wider than a page image',
      pdfOutput([{page: 1, bytes: jpegBytes(PAGE_IMAGE_PIXELS + 1, 900)}]),
    ],
    [
      'a JPEG taller than a page image',
      pdfOutput([{page: 1, bytes: jpegBytes(900, PAGE_IMAGE_PIXELS + 1)}]),
    ],
    ['a JPEG with no height', pdfOutput([{page: 1, bytes: jpegBytes(900, 0)}])],
    [
      'a JPEG over the size limit',
      pdfOutput([
        {page: 1, bytes: jpegBytes(900, 900, PAGE_IMAGE_SIZE_LIMIT + 1)},
      ]),
    ],
    [
      'a JPEG whose header stops short',
      pdfOutput([{page: 1, bytes: jpegBytes(900, 900).subarray(0, 24)}]),
    ],
    [
      'pages out of order',
      pdfOutput([
        {page: 2, bytes: jpegBytes(900, 900)},
        {page: 1, bytes: jpegBytes(900, 900)},
      ]),
    ],
    [
      'a page twice',
      pdfOutput([
        {page: 1, bytes: jpegBytes(900, 900)},
        {page: 1, bytes: jpegBytes(900, 900)},
      ]),
    ],
    [
      'more page images than a PDF gets',
      pdfOutput(
        Array.from({length: PAGE_IMAGES_PER_PDF + 1}, (_, at) => ({
          page: at + 1,
          bytes: jpegBytes(10, 10),
        }))
      ),
    ],
    [
      'a stop to page images before a PDF has its share',
      {
        ...pdfOutput([{page: 1, bytes: jpegBytes(10, 10)}]),
        imagesStopped: true,
      },
    ],
  ])('fails on %s', (_case, data) => {
    expect(validateOutput(data, PDF)).toEqual({type: 'failed'})
  })

  it('takes as many page images as a PDF gets', () => {
    const output = pdfOutput(
      Array.from({length: PAGE_IMAGES_PER_PDF}, (_, at) => ({
        page: at + 1,
        bytes: jpegBytes(10, 10),
      }))
    )

    expect(validateOutput(output, PDF)).toMatchObject({type: 'read'})
    expect(validateOutput({...output, imagesStopped: true}, PDF)).toMatchObject(
      {
        type: 'read',
        imagesStopped: true,
      }
    )
  })

  it('fails page images, or a stop to them, on a file that is not a PDF', () => {
    const docx = {
      type: 'read',
      format: 'docx',
      text: text('Hi'),
      pageImages: [],
      imagesStopped: false,
    }

    expect(
      validateOutput(
        {...docx, pageImages: [{page: 1, bytes: jpegBytes(10, 10)}]},
        DOCX
      )
    ).toEqual({type: 'failed'})
    expect(validateOutput({...docx, imagesStopped: true}, DOCX)).toEqual({
      type: 'failed',
    })
  })

  it.each([
    ['a PDF', 'pdf', DOCX],
    ['an office file', 'docx', PDF],
    ['an RTF', 'rtf', PDF],
    ['a notebook', 'ipynb', DOCX],
  ])(
    'fails output that says %s when the bytes are something else',
    (_case, format, bytes) => {
      expect(
        validateOutput(
          {
            type: 'read',
            format,
            text: text('Hi'),
            pageImages: [],
            imagesStopped: false,
          },
          bytes
        )
      ).toEqual({type: 'failed'})
    }
  )
})

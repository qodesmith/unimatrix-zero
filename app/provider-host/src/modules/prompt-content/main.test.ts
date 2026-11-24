import type {HostAttachment} from '@uz/contract/attachments'

import {attachedFiles} from '#modules/test-attachments/main'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {describe, expect, it, onTestFinished} from 'vitest'

import {earlierPrompted, prompted, readContent} from './main'

function tempFolder() {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-prompt-content-'))
  onTestFinished(() => fs.rmSync(made, {recursive: true, force: true}))

  return made
}

const extracted: HostAttachment = {
  name: 'scan.pdf',
  path: '/attachments/abc/scan.pdf',
  folder: false,
  inline: null,
  extraction: {
    text: '/attachments/extractions/abc/v1/text.txt',
    pageImages: [
      {page: 2, path: '/attachments/extractions/abc/v1/page-2.jpg'},
      {page: 5, path: '/attachments/extractions/abc/v1/page-5.jpg'},
    ],
    imagesStopped: false,
  },
}

const EXTRACTED_LINES = [
  '[Attached file "scan.pdf" is saved at: /attachments/abc/scan.pdf]',
  '[The text of "scan.pdf" is saved at: /attachments/extractions/abc/v1/text.txt]',
  '[Page 2 of "scan.pdf", as an image, is saved at: /attachments/extractions/abc/v1/page-2.jpg]',
  '[Page 5 of "scan.pdf", as an image, is saved at: /attachments/extractions/abc/v1/page-5.jpg]',
]

describe('an Extraction’s path lines', () => {
  it('follow the original’s path line, the text first and then each page image', async () => {
    const content = await readContent(
      prompted({text: 'Sum it up.', attachments: [extracted]})
    )

    expect(content).toEqual([
      {type: 'text', text: [...EXTRACTED_LINES, 'Sum it up.'].join('\n')},
    ])
  })

  it('leave out the text when the file has none', async () => {
    const scanOnly: HostAttachment = {
      ...extracted,
      extraction: {
        text: null,
        pageImages: [{page: 1, path: '/x/page-1.jpg'}],
        imagesStopped: false,
      },
    }

    const content = await readContent(
      prompted({text: '', attachments: [scanOnly]})
    )

    expect(content).toEqual([
      {
        type: 'text',
        text: [
          EXTRACTED_LINES[0],
          '[Page 1 of "scan.pdf", as an image, is saved at: /x/page-1.jpg]',
        ].join('\n'),
      },
    ])
  })

  it('say when page images stopped at 100 and the text covers the rest', async () => {
    const long: HostAttachment = {
      ...extracted,
      extraction: {text: '/x/text.txt', pageImages: [], imagesStopped: true},
    }

    const content = await readContent(prompted({text: '', attachments: [long]}))

    expect(content).toEqual([
      {
        type: 'text',
        text: [
          EXTRACTED_LINES[0],
          '[The text of "scan.pdf" is saved at: /x/text.txt]',
          '[Only the first 100 pages of "scan.pdf" that needed a page image have one; its text covers every page]',
        ].join('\n'),
      },
    ])
  })

  it('come after a file sent inline, which stays right after its own line', async () => {
    const {notes} = attachedFiles(tempFolder())

    const withText: HostAttachment = {
      ...notes,
      extraction: {text: '/x/text.txt', pageImages: [], imagesStopped: false},
    }

    const content = await readContent(
      prompted({text: 'Read.', attachments: [withText]})
    )

    expect(content).toEqual([
      {
        type: 'text',
        text: [
          `[Attached file "notes.txt" is saved at: ${notes.path}]`,
          '<file name="notes.txt">\nBuy milk.\n</file>',
          '[The text of "notes.txt" is saved at: /x/text.txt]',
          'Read.',
        ].join('\n'),
      },
    ])
  })

  it('go with an earlier Prompt’s file, and not with one that can no longer be read', async () => {
    const folder = tempFolder()
    const original = path.join(folder, 'scan.pdf')
    fs.writeFileSync(original, '%PDF-1')
    const kept = {...extracted, path: original}
    const gone = {...extracted, path: path.join(folder, 'gone.pdf')}

    const content = await readContent(
      earlierPrompted({text: 'Before.', attachments: [kept, gone]})
    )

    expect(content).toEqual([
      {
        type: 'text',
        text: [
          `[Attached file "scan.pdf" is saved at: ${original}]`,
          ...EXTRACTED_LINES.slice(1),
          '[Attached file "scan.pdf" can no longer be read]',
          'Before.',
        ].join('\n'),
      },
    ])
  })
})

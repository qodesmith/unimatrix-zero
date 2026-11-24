import type {HostAttachment} from '@uz/contract/attachments'

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

export const PNG_BASE64 = 'iVBORw=='

export const SHRUNK_BASE64 = '/9j/'

export const PDF_BASE64 = 'JVBERi0x'

function keep(folder: string, name: string, bytes: Uint8Array) {
  const file = path.join(folder, name)
  fs.writeFileSync(file, bytes)

  return file
}

export function byPathOnly(attachment: HostAttachment): HostAttachment {
  return {...attachment, inline: null}
}

/** Marked inline as main would mark them for Claude. */
export function attachedFiles(folder: string) {
  function save(name: string, ...bytes: number[]) {
    return keep(folder, name, Uint8Array.from(bytes))
  }

  const notes = keep(folder, 'notes.txt', Buffer.from('Buy milk.', 'utf8'))
  const chart = save('chart.png', 0x89, 0x50, 0x4e, 0x47)
  const report = keep(folder, 'report.pdf', Buffer.from('%PDF-1', 'ascii'))
  const photo = save('photo.jpg', 0xff, 0xd8, 0xff, 0xe0)
  const shrunk = save('photo.shrunk.jpg', 0xff, 0xd8, 0xff)
  const archive = save('archive.zip', 0x50, 0x4b)
  const project = path.join(folder, 'project')
  fs.mkdirSync(project)

  return {
    notes: {
      name: 'notes.txt',
      path: notes,
      folder: false,
      inline: {type: 'text'},
      extraction: null,
    },
    chart: {
      name: 'chart.png',
      path: chart,
      folder: false,
      inline: {type: 'image', mediaType: 'image/png', path: chart},
      extraction: null,
    },
    report: {
      name: 'report.pdf',
      path: report,
      folder: false,
      inline: {type: 'pdf'},
      extraction: null,
    },
    photo: {
      name: 'photo.jpg',
      path: photo,
      folder: false,
      inline: {type: 'image', mediaType: 'image/jpeg', path: shrunk},
      extraction: null,
    },
    archive: {
      name: 'archive.zip',
      path: archive,
      folder: false,
      inline: null,
      extraction: null,
    },
    project: {
      name: 'project',
      path: project,
      folder: true,
      inline: null,
      extraction: null,
    },
    gone: {
      name: 'gone.txt',
      path: path.join(folder, 'gone.txt'),
      folder: false,
      inline: {type: 'text'},
      extraction: null,
    },
  } satisfies Record<string, HostAttachment>
}

const GLYPHS = new Map([
  ['E', ['#####', '#....', '#....', '####.', '#....', '#....', '#####']],
  ['H', ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#']],
  ['N', ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#']],
  ['O', ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.']],
  ['R', ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#']],
])

const DOT = 16
const MARGIN = 32

function chunk(type: string, data: Uint8Array) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const framed = Buffer.alloc(body.length + 8)
  framed.writeUInt32BE(data.length, 0)
  body.copy(framed, 4)
  framed.writeUInt32BE(zlib.crc32(body), body.length + 4)

  return framed
}

function wordPng(word: string) {
  const glyphs = Array.from(word, letter => {
    const glyph = GLYPHS.get(letter)

    if (!glyph) throw new Error(`No glyph for “${letter}”.`)

    return glyph
  })

  const width = MARGIN * 2 + glyphs.length * 6 * DOT - DOT
  const height = MARGIN * 2 + 7 * DOT
  const rows = Buffer.alloc((width + 1) * height, 0xff)

  for (let y = 0; y < height; y++) rows[y * (width + 1)] = 0

  for (const [at, glyph] of glyphs.entries()) {
    for (const [row, dots] of glyph.entries()) {
      for (const [column, dot] of Array.from(dots).entries()) {
        if (dot !== '#') continue

        const left = MARGIN + (at * 6 + column) * DOT
        const top = MARGIN + row * DOT

        for (let y = top; y < top + DOT; y++) {
          rows.fill(
            0,
            y * (width + 1) + 1 + left,
            y * (width + 1) + 1 + left + DOT
          )
        }
      }
    }
  }

  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header.set([8, 0, 0, 0, 0], 8)

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows)),
    chunk('IEND', new Uint8Array()),
  ])
}

/** `word` may use only E, H, N, O and R. The file name hides the word. */
export function pngShowing(folder: string, word: string): HostAttachment {
  const file = keep(folder, 'word.png', wordPng(word))

  return {
    name: 'word.png',
    path: file,
    folder: false,
    inline: {type: 'image', mediaType: 'image/png', path: file},
    extraction: null,
  }
}

export function pdfSaying(folder: string, sentence: string): HostAttachment {
  const text = `BT /F1 24 Tf 72 700 Td (${sentence}) Tj ET`

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]

  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []

  for (const [at, body] of objects.entries()) {
    offsets.push(pdf.length)
    pdf += `${at + 1} 0 obj\n${body}\nendobj\n`
  }

  const xref = pdf.length

  const entries = offsets.map(
    offset => `${String(offset).padStart(10, '0')} 00000 n \n`
  )

  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${entries.join('')}`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`

  return {
    name: 'note.pdf',
    path: keep(folder, 'note.pdf', Buffer.from(pdf, 'latin1')),
    folder: false,
    inline: {type: 'pdf'},
    extraction: null,
  }
}

/** A file the AI can open only from its path. */
export function fileHolding(
  folder: string,
  name: string,
  bytes: Uint8Array
): HostAttachment {
  return {
    name,
    path: keep(folder, name, bytes),
    folder: false,
    inline: null,
    extraction: null,
  }
}

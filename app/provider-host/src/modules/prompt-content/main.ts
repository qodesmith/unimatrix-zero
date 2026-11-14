import type {ConvertedPage} from '#modules/pdf-conversion/main'
import type {HostAttachment} from '@uz/contract/attachments'

import {readFile} from 'node:fs/promises'

interface Text {
  type: 'text'
  text: string
}

/**
 * What a Provider is sent, before its files are read: text, and the files in
 * place. Adjacent texts are lines.
 */
export type Piece = Text | {type: 'file'; file: HostAttachment}

/** What a Provider is sent, before a driver puts it in its own wire format. */
export type ContentPart =
  | Text
  | {
      type: 'image'
      mediaType: Exclude<
        HostAttachment['mediaType'],
        'application/pdf' | 'text/plain'
      >
      base64: string
    }
  | {type: 'document'; name: string; base64: string}

export type ConvertPdf = (
  original: HostAttachment,
  conversionDir: string
) => Promise<ConvertedPage[]>

export interface ContentOptions {
  /** The Provider's capability; without it each PDF goes converted. */
  pdfAttachments: boolean
  conversionDir: string
  convertPdf: ConvertPdf
}

interface Prompt {
  text: string
  attachments: HostAttachment[]
}

export function lines(...texts: string[]): Piece[] {
  return texts.map(text => ({type: 'text', text}))
}

export function files(attached: HostAttachment[]): Piece[] {
  return attached.map(file => ({type: 'file', file}))
}

/** Each run of texts as one text, its lines joined. */
export function joinLines(pieces: Piece[]): Piece[] {
  const joined: Piece[] = []

  for (const piece of pieces) {
    const last = joined.at(-1)

    if (piece.type === 'text' && last?.type === 'text') {
      joined[joined.length - 1] = {
        type: 'text',
        text: `${last.text}\n${piece.text}`,
      }
    } else {
      joined.push(piece)
    }
  }

  return joined
}

/** A Prompt's files go before its text, as the vendors advise. */
export function prompted({text, attachments}: Prompt): Piece[] {
  return joinLines([...files(attachments), ...lines(text)])
}

function fileText(name: string, text: string, page?: number) {
  const where = page === undefined ? '' : ` page="${page}"`

  return `<file name=${JSON.stringify(name)}${where}>\n${text}\n</file>`
}

async function read(attachment: HostAttachment) {
  try {
    return await readFile(attachment.path)
  } catch (error) {
    const reason = error instanceof Error ? `: ${error.message}` : ''

    throw new Error(
      `Couldn’t read the attached file “${attachment.name}”${reason}`,
      {cause: error}
    )
  }
}

/** Each page's text under the file's name, and its image after it. */
async function converted(
  attachment: HostAttachment,
  {conversionDir, convertPdf}: ContentOptions
) {
  const parts: ContentPart[] = []

  for (const [at, {text, image}] of (
    await convertPdf(attachment, conversionDir)
  ).entries()) {
    parts.push({type: 'text', text: fileText(attachment.name, text, at + 1)})

    if (image) {
      parts.push({
        type: 'image',
        mediaType: 'image/png',
        base64: Buffer.from(image).toString('base64'),
      })
    }
  }

  return parts
}

async function partsOf(
  attachment: HostAttachment,
  options: ContentOptions
): Promise<ContentPart[]> {
  const {name, mediaType} = attachment

  switch (mediaType) {
    case 'text/plain':
      return [
        {
          type: 'text',
          text: fileText(name, (await read(attachment)).toString('utf8')),
        },
      ]
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp':
      return [
        {
          type: 'image',
          mediaType,
          base64: (await read(attachment)).toString('base64'),
        },
      ]
    case 'application/pdf':
      if (!options.pdfAttachments) return converted(attachment, options)

      return [
        {
          type: 'document',
          name,
          base64: (await read(attachment)).toString('base64'),
        },
      ]
    default:
      throw new Error('Unknown attachment type.')
  }
}

function joinParts(parts: ContentPart[]) {
  const joined: ContentPart[] = []

  for (const part of parts) {
    const last = joined.at(-1)

    if (part.type === 'text' && last?.type === 'text') {
      joined[joined.length - 1] = {
        type: 'text',
        text: `${last.text}\n${part.text}`,
      }
    } else {
      joined.push(part)
    }
  }

  return joined
}

/**
 * Reads each file from its original, and converts a PDF afresh for a Provider
 * that can't take one, so losses never pile up. Never empty, and no text in it
 * is empty unless it is the only part.
 */
export async function readContent(
  pieces: Piece[],
  options: ContentOptions
): Promise<ContentPart[]> {
  const parts = await Promise.all(
    pieces.map(async piece =>
      piece.type === 'text' ? [piece] : partsOf(piece.file, options)
    )
  )

  const shown = joinParts(parts.flat()).filter(
    part => part.type !== 'text' || part.text !== ''
  )

  return shown.length === 0 ? [{type: 'text', text: ''}] : shown
}

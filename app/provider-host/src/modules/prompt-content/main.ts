import type {HostAttachment, ImageMediaType} from '@uz/contract/attachments'
import type {ReplyRequest} from '@uz/contract/host'

import {readFile} from 'node:fs/promises'

export interface Text {
  type: 'text'
  text: string
}

type InlineFile = HostAttachment & {
  inline: NonNullable<HostAttachment['inline']>
}

/** A Prompt before its inline files are read. Adjacent texts are lines. */
export type Piece = Text | {type: 'file'; file: InlineFile}

/** What a Provider is sent, before a driver puts it in its own wire format. */
export type ContentPart =
  | Text
  | {type: 'image'; mediaType: ImageMediaType; base64: string}
  | {type: 'document'; name: string; base64: string}

type Prompt = Pick<ReplyRequest['prompt'], 'text' | 'attachments'>

export function lines(...texts: string[]): Piece[] {
  return texts.map(text => ({type: 'text', text}))
}

function pathLine({name, path, folder}: HostAttachment) {
  return folder
    ? `[Attached folder "${name}" is at: ${path}]`
    : `[Attached file "${name}" is saved at: ${path}]`
}

/** Main decides what goes inline; nothing here looks at a type or a size. */
export function files(attached: HostAttachment[]): Piece[] {
  return attached.flatMap((file): Piece[] => {
    const {inline} = file

    return [
      ...lines(pathLine(file)),
      ...(inline ? [{type: 'file' as const, file: {...file, inline}}] : []),
    ]
  })
}

export function joinLines<Part extends {type: string}>(
  parts: (Part | Text)[]
): (Part | Text)[] {
  const joined: (Part | Text)[] = []

  for (const part of parts) {
    const last = joined.at(-1)

    if (isText(part) && last && isText(last)) {
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

function isText(part: {type: string}): part is Text {
  return part.type === 'text'
}

export function prompted({text, attachments}: Prompt): Piece[] {
  return joinLines([
    ...files(attachments),
    ...(text === '' && attachments.length > 0 ? [] : lines(text)),
  ])
}

function fileText(name: string, text: string) {
  return `<file name=${JSON.stringify(name)}>\n${text}\n</file>`
}

async function read(name: string, file: string) {
  try {
    return await readFile(file)
  } catch (error) {
    const reason = error instanceof Error ? `: ${error.message}` : ''

    throw new Error(`Couldn’t read the attached file “${name}”${reason}`, {
      cause: error,
    })
  }
}

async function inlinePart({
  name,
  path,
  inline,
}: InlineFile): Promise<ContentPart> {
  switch (inline.type) {
    case 'image':
      return {
        type: 'image',
        mediaType: inline.mediaType,
        base64: (await read(name, inline.path)).toString('base64'),
      }
    case 'pdf':
      return {
        type: 'document',
        name,
        base64: (await read(name, path)).toString('base64'),
      }
    case 'text':
      return {
        type: 'text',
        text: fileText(name, (await read(name, path)).toString('utf8')),
      }
    default:
      throw new Error('Unknown inline form.')
  }
}

/**
 * Reads each inline file afresh. Never empty, and no text in it is empty
 * unless it is the only part.
 */
export async function readContent(pieces: Piece[]): Promise<ContentPart[]> {
  const parts = await Promise.all(
    pieces.map(async piece =>
      piece.type === 'text' ? piece : inlinePart(piece.file)
    )
  )

  const shown = joinLines(parts).filter(
    part => part.type !== 'text' || part.text !== ''
  )

  return shown.length === 0 ? [{type: 'text', text: ''}] : shown
}

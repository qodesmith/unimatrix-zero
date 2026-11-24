import type {HostAttachment, ImageMediaType} from '@uz/contract/attachments'
import type {ReplyRequest} from '@uz/contract/host'

import {access, constants, readFile} from 'node:fs/promises'

export interface Text {
  type: 'text'
  text: string
}

type InlineFile = HostAttachment & {
  inline: NonNullable<HostAttachment['inline']>
}

/**
 * A Prompt before its files are read. Adjacent texts are lines. An earlier
 * Prompt's file gets its line on reading: its path, or that it is gone.
 */
export type Piece =
  | Text
  | {type: 'file'; file: InlineFile}
  | {type: 'earlier-file'; file: HostAttachment}

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
function files(attached: HostAttachment[]): Piece[] {
  return attached.flatMap((file): Piece[] => {
    const {inline} = file

    return [
      ...lines(pathLine(file)),
      ...(inline ? [{type: 'file' as const, file: {...file, inline}}] : []),
    ]
  })
}

/** An earlier Prompt's: a file that can no longer be read fails nothing. */
export function earlierFiles(attached: HostAttachment[]): Piece[] {
  return attached.map(file =>
    file.folder
      ? {type: 'text', text: pathLine(file)}
      : {type: 'earlier-file', file}
  )
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

function withText(attached: Piece[], {text, attachments}: Prompt) {
  return joinLines([
    ...attached,
    ...(text === '' && attachments.length > 0 ? [] : lines(text)),
  ])
}

/** The Prompt being sent: a file of its own that can't be read fails it. */
export function prompted(prompt: Prompt): Piece[] {
  return withText(files(prompt.attachments), prompt)
}

export function earlierPrompted(prompt: Prompt): Piece[] {
  return withText(earlierFiles(prompt.attachments), prompt)
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

async function readable(file: string) {
  try {
    await access(file, constants.R_OK)

    return true
  } catch {
    return false
  }
}

function goneLine(name: string): Text {
  return {type: 'text', text: `[Attached file "${name}" can no longer be read]`}
}

async function earlierParts(file: HostAttachment): Promise<ContentPart[]> {
  if (!(await readable(file.path))) return [goneLine(file.name)]

  const line: Text = {type: 'text', text: pathLine(file)}
  const {inline} = file

  if (!inline) return [line]

  try {
    return [line, await inlinePart({...file, inline})]
  } catch {
    // The copy read a moment ago, so only an image's shrunk copy can be gone.
    return inline.type === 'image' && inline.path !== file.path
      ? [line]
      : [goneLine(file.name)]
  }
}

async function partsOf(piece: Piece): Promise<ContentPart[]> {
  switch (piece.type) {
    case 'text':
      return [piece]
    case 'file':
      return [await inlinePart(piece.file)]
    case 'earlier-file':
      return earlierParts(piece.file)
    default:
      throw new Error('Unknown piece.')
  }
}

/**
 * Reads each inline file afresh. Never empty, and no text in it is empty
 * unless it is the only part.
 */
export async function readContent(pieces: Piece[]): Promise<ContentPart[]> {
  const parts = (await Promise.all(pieces.map(partsOf))).flat()

  const shown = joinLines(parts).filter(
    part => part.type !== 'text' || part.text !== ''
  )

  return shown.length === 0 ? [{type: 'text', text: ''}] : shown
}

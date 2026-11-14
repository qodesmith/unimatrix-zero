import type {ContentPart, ConvertPdf, Piece} from '#modules/prompt-content/main'
import type {ContentItem} from './protocol/ContentItem'
import type {UserInput} from './protocol/v2/UserInput'
import type {ReplyRequest} from '@uz/contract/host'

import {prompted, readContent} from '#modules/prompt-content/main'
import {replayed} from '#modules/thread-replay/main'
import {PROVIDER_CAPABILITIES} from '@uz/contract/providers'

/**
 * Inline, not a `localImage` path, which Codex would show the Model. No
 * `detail`: Codex fits the image itself, and `low` would drop it.
 */
function dataUrl(part: Extract<ContentPart, {type: 'image'}>) {
  return `data:${part.mediaType};base64,${part.base64}`
}

function noDocuments(): never {
  throw new Error('Codex takes no PDF: it is sent converted.')
}

/** A Prompt as `turn/start` takes it. */
function turnInput(parts: ContentPart[]): UserInput[] {
  return parts.map(part => {
    switch (part.type) {
      case 'text':
        return {type: 'text', text: part.text, text_elements: []}
      case 'image':
        return {type: 'image', url: dataUrl(part)}
      case 'document':
        return noDocuments()
      default:
        throw new Error('Unknown content.')
    }
  })
}

/**
 * Reads the Prompt's files at once, so an unreadable original fails the Reply
 * before Codex starts. Codex takes no PDF, so each one goes converted.
 */
export async function codexContent(
  request: ReplyRequest,
  convertPdf: ConvertPdf
) {
  async function read(pieces: Piece[]) {
    return readContent(pieces, {
      pdfAttachments: PROVIDER_CAPABILITIES.chatgpt.pdfAttachments,
      conversionDir: request.conversionDir,
      convertPdf,
    })
  }

  const prompt = await read(prompted(request.prompt))

  return {
    read,
    /** After the whole Thread, when the thread holds none of it. */
    async input(replay: boolean) {
      return turnInput(
        replay ? await read(replayed(request.thread, request.prompt)) : prompt
      )
    },
  }
}

/** A Prompt as a user message `thread/inject_items` takes. */
export function messageContent(parts: ContentPart[]) {
  return parts.map(part => {
    switch (part.type) {
      case 'text':
        return {type: 'input_text', text: part.text} satisfies ContentItem
      case 'image':
        return {
          type: 'input_image',
          image_url: dataUrl(part),
        } satisfies ContentItem
      case 'document':
        return noDocuments()
      default:
        throw new Error('Unknown content.')
    }
  })
}

import type {ContentPart, Piece} from '#modules/prompt-content/main'
import type {ContentItem} from './protocol/ContentItem'
import type {UserInput} from './protocol/v2/UserInput'
import type {ReplyRequest} from '@uz/contract/host'

import {prompted, readContent} from '#modules/prompt-content/main'
import {replayed} from '#modules/thread-replay/main'

/** What Codex takes: main marks no PDF inline for ChatGPT. */
export type CodexPart = Exclude<ContentPart, {type: 'document'}>

/**
 * Inline as a `data:` URL, never a `localImage`. No `detail`: Codex fits the
 * image itself, and `low` would drop it.
 */
function dataUrl(part: Extract<CodexPart, {type: 'image'}>) {
  return `data:${part.mediaType};base64,${part.base64}`
}

function turnInput(parts: CodexPart[]): UserInput[] {
  return parts.map(part => {
    switch (part.type) {
      case 'text':
        return {type: 'text', text: part.text, text_elements: []}
      case 'image':
        return {type: 'image', url: dataUrl(part)}
      default:
        throw new Error('Unknown content.')
    }
  })
}

export async function read(pieces: Piece[]): Promise<CodexPart[]> {
  const parts = await readContent(pieces)

  return parts.map(part => {
    if (part.type === 'document') {
      throw new Error(`ChatGPT takes no PDF inline: “${part.name}”.`)
    }

    return part
  })
}

/**
 * Reads the Prompt's inline files at once, so an unreadable one fails the
 * Reply before Codex starts.
 */
export async function codexContent(request: ReplyRequest) {
  const prompt = await read(prompted(request.prompt))

  return {
    async input(replay: boolean) {
      return turnInput(
        replay ? await read(replayed(request.thread, request.prompt)) : prompt
      )
    },
  }
}

export function messageContent(parts: CodexPart[]) {
  return parts.map(part => {
    switch (part.type) {
      case 'text':
        return {type: 'input_text', text: part.text} satisfies ContentItem
      case 'image':
        return {
          type: 'input_image',
          image_url: dataUrl(part),
        } satisfies ContentItem
      default:
        throw new Error('Unknown content.')
    }
  })
}

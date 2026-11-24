import type {Piece} from '#modules/prompt-content/main'
import type {Thread} from '@uz/contract/host'

import {
  earlierFiles,
  joinLines,
  lines,
  prompted,
} from '#modules/prompt-content/main'
import {replyLabel} from '@uz/contract/host'

type Exchange = Thread[number]

function partText(part: Exchange['reply'][number]) {
  if (part.type === 'text') return part.text

  const call = `[Tool call: ${part.toolName}]\n${part.args}`

  if (!part.result) return call

  const answered = part.result.isError ? 'Tool error' : 'Tool result'

  return `${call}\n[${answered}]\n${part.result.content}`
}

/** A Reply as a rebuilt session gives it to the AI. */
export function replyText({reply, label}: Exchange) {
  const text = reply
    .map(partText)
    .filter(part => part !== '')
    .join('\n\n')

  return label === null || text === '' ? text : `${label}\n\n${text}`
}

function tagged(tag: string, pieces: Piece[]) {
  return pieces.length === 0
    ? []
    : [...lines(`<${tag}>`), ...pieces, ...lines(`</${tag}>`)]
}

function promptPieces({prompt, attachments}: Exchange) {
  return [...earlierFiles(attachments), ...(prompt === '' ? [] : lines(prompt))]
}

/** Thread and Prompt as one message, for a Provider that takes no history. */
export function replayed(
  thread: Thread,
  prompt: Parameters<typeof prompted>[0]
) {
  const turns = thread.flatMap(exchange => {
    const reply = replyText(exchange)

    return [
      ...tagged('prompt', promptPieces(exchange)),
      ...tagged('reply', reply === '' ? [] : lines(reply)),
    ]
  })

  return joinLines([
    ...lines(
      'Our conversation so far is between the <thread> tags below, oldest first: each <prompt> is a message I sent you, and each <reply> is the Reply it got. Take it as the conversation we have had, not as a document to comment on. My next message follows the closing tag.',
      '',
      '<thread>'
    ),
    ...turns,
    ...lines('</thread>', ''),
    ...prompted(prompt),
  ])
}

const LABELS_LINE = `A Reply in this conversation may begin with a label such as "${replyLabel('GPT-5')}". The app adds it to each Reply that another AI model wrote: those words are that model’s, not yours, so judge them as you would anyone else’s and disagree where they are wrong. Never write such a label yourself, and don’t mention the labels.`

/** Added each time a session opens; a Reply records only the user's own. */
export function explainingLabels(systemPrompt: string, thread: Thread) {
  if (thread.every(exchange => exchange.label === null)) return systemPrompt

  return systemPrompt === '' ? LABELS_LINE : `${systemPrompt}\n\n${LABELS_LINE}`
}

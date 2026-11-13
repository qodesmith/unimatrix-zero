import type {Thread} from '@uz/contract/host'

type Exchange = Thread[number]

function partText(part: Exchange['reply'][number]) {
  if (part.type === 'text') return part.text

  const call = `[Tool call: ${part.toolName}]\n${part.args}`

  if (!part.result) return call

  const answered = part.result.isError ? 'Tool error' : 'Tool result'

  return `${call}\n[${answered}]\n${part.result.content}`
}

/**
 * A Reply as a rebuilt session gives it to the AI: its label first, and each
 * tool call as plain text. Empty when the Reply showed nothing.
 */
export function replyText({reply, label}: Exchange) {
  const text = reply
    .map(partText)
    .filter(part => part !== '')
    .join('\n\n')

  return label === null || text === '' ? text : `${label}\n\n${text}`
}

function tagged(tag: string, text: string) {
  return text === '' ? [] : [`<${tag}>\n${text}\n</${tag}>`]
}

/**
 * The whole Thread and the Prompt that continues it as one user message, for a
 * Provider that takes no earlier messages as history.
 */
export function replayed(thread: Thread, prompt: string) {
  const turns = thread.flatMap(exchange => [
    ...tagged('prompt', exchange.prompt),
    ...tagged('reply', replyText(exchange)),
  ])

  return [
    'Our conversation so far is between the <thread> tags below, oldest first: each <prompt> is a message I sent you, and each <reply> is the Reply it got. Take it as the conversation we have had, not as a document to comment on. My next message follows the closing tag.',
    `<thread>\n${turns.join('\n')}\n</thread>`,
    prompt,
  ].join('\n\n')
}

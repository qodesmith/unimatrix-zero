import type {Thread} from '@uz/contract/host'

import {replyLabel} from '@uz/contract/host'

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

const LABELS_LINE = `A Reply in this conversation may begin with a label such as "${replyLabel('GPT-5')}". The app adds it to each Reply that another AI model wrote: those words are that model’s, not yours, so judge them as you would anyone else’s and disagree where they are wrong. Never write such a label yourself, and don’t mention the labels.`

/**
 * The System prompt a session for the Thread gets each time it opens. The
 * Reply records only the user's own, which the line is no part of.
 */
export function explainingLabels(systemPrompt: string, thread: Thread) {
  if (thread.every(exchange => exchange.label === null)) return systemPrompt

  return systemPrompt === '' ? LABELS_LINE : `${systemPrompt}\n\n${LABELS_LINE}`
}

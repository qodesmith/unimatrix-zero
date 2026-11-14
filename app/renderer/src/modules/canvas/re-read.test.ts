import type {ProviderId} from '@uz/contract/providers'
import type {Prompt, Reply} from '@uz/contract/turns'

import {expect, it} from 'vitest'

import {
  RE_READ_NOTE_FROM,
  SETUP_TOKENS,
  contextSizeAt,
  reReadNote,
} from './re-read'
import {indexTurns} from './tree'

const treeId = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'
const createdAt = '2026-10-19T12:00:00.000Z'

interface Exchange {
  prompt: Prompt
  reply: Reply
}

function exchange(
  parentReplyId: string | null,
  contextSize: number | null,
  provider: ProviderId = 'claude'
): Exchange {
  const prompt: Prompt = {
    id: crypto.randomUUID(),
    treeId,
    parentReplyId,
    text: 'Hi',
    attachments: [],
    createdAt,
  }

  return {
    prompt,
    reply: {
      id: crypto.randomUUID(),
      treeId,
      promptId: prompt.id,
      provider,
      model: provider === 'claude' ? 'haiku' : 'gpt-6-sol',
      status: 'complete',
      content: [],
      contextSize,
      contextWindow: null,
      failure: null,
      compacted: false,
      rebuilt: false,
      createdAt,
    },
  }
}

const GPT = {provider: 'chatgpt', model: 'gpt-6-sol'} as const
const CLAUDE = {provider: 'claude', model: 'opus'} as const

function claudeReply(contextSize: number) {
  return exchange(null, contextSize).reply
}

function onClaude(size: number) {
  return {provider: 'claude', size} as const
}

it('says how much of the Thread another Provider will re-read, Context size and setup together, in thousands', () => {
  const size = 47_600 - SETUP_TOKENS.chatgpt + SETUP_TOKENS.claude

  expect(
    reReadNote({
      attachedTo: claudeReply(size),
      context: onClaude(size),
      to: GPT,
    })
  ).toBe(
    'Switching to ChatGPT will re-read ~48k tokens of this conversation (uses more of your limit).'
  )
})

/** The note for a ChatGPT Thread of `threadTokens` tokens going to Claude. */
function chatgptToClaude(threadTokens: number) {
  const size = threadTokens + SETUP_TOKENS.chatgpt

  return reReadNote({
    attachedTo: exchange(null, size, 'chatgpt').reply,
    context: {provider: 'chatgpt', size},
    to: CLAUDE,
  })
}

it('swaps the setup the Context size carries for the new Provider’s', () => {
  expect(chatgptToClaude(5000)).toBeNull()
  expect(chatgptToClaude(30_000)).toBe(
    'Switching to Claude will re-read ~31k tokens of this conversation (uses more of your limit).'
  )
})

it('shows from about 20k tokens, setup included, and not below', () => {
  const below =
    RE_READ_NOTE_FROM - SETUP_TOKENS.chatgpt + SETUP_TOKENS.claude - 1

  const from = below + 1

  expect(
    reReadNote({
      attachedTo: claudeReply(below),
      context: onClaude(below),
      to: GPT,
    })
  ).toBeNull()
  expect(
    reReadNote({
      attachedTo: claudeReply(from),
      context: onClaude(from),
      to: GPT,
    })
  ).not.toBeNull()
})

it('says nothing on the Thread’s own Provider, at the root, or with no Context size to go by', () => {
  const reply = claudeReply(100_000)
  const context = onClaude(100_000)

  expect(reReadNote({attachedTo: reply, context, to: CLAUDE})).toBeNull()
  expect(reReadNote({attachedTo: null, context, to: GPT})).toBeNull()
  expect(reReadNote({attachedTo: reply, context: null, to: GPT})).toBeNull()
  expect(reReadNote({attachedTo: reply, context, to: null})).toBeNull()
})

it('takes the Context size of the nearest Reply above that has one, with that Reply’s Provider', () => {
  const root = exchange(null, 30_000)
  const middle = exchange(root.reply.id, 45_000, 'chatgpt')
  const stopped = exchange(middle.reply.id, null)

  const index = indexTurns({
    prompts: [root.prompt, middle.prompt, stopped.prompt],
    replies: [root.reply, middle.reply, stopped.reply],
  })

  expect(contextSizeAt(index, stopped.reply)).toEqual({
    provider: 'chatgpt',
    size: 45_000,
  })
  expect(contextSizeAt(index, root.reply)).toEqual(onClaude(30_000))
  expect(contextSizeAt(index, null)).toBeNull()
})

it('has no Context size when no Reply on the Thread has one', () => {
  const root = exchange(null, null)
  const index = indexTurns({prompts: [root.prompt], replies: [root.reply]})

  expect(contextSizeAt(index, root.reply)).toBeNull()
})

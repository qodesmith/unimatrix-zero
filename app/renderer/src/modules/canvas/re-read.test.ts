import type {Prompt, Reply} from '@uz/contract/turns'

import {SETUP_TOKENS} from '@uz/contract/providers'
import {expect, it} from 'vitest'

import {RE_READ_NOTE_FROM, contextSizeAt, reReadNote} from './re-read'
import {indexTurns} from './tree'

const treeId = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'
const createdAt = '2026-10-19T12:00:00.000Z'

interface Exchange {
  prompt: Prompt
  reply: Reply
}

function exchange(
  parentReplyId: string | null,
  contextSize: number | null
): Exchange {
  const prompt: Prompt = {
    id: crypto.randomUUID(),
    treeId,
    parentReplyId,
    text: 'Hi',
    createdAt,
  }

  return {
    prompt,
    reply: {
      id: crypto.randomUUID(),
      treeId,
      promptId: prompt.id,
      provider: 'claude',
      model: 'haiku',
      status: 'complete',
      content: [],
      contextSize,
      contextWindow: null,
      failure: null,
      compacted: false,
      createdAt,
    },
  }
}

const GPT = {provider: 'chatgpt', model: 'gpt-6-sol'} as const

function claudeReply(contextSize: number) {
  return exchange(null, contextSize).reply
}

it('says how much of the Thread another Provider will re-read, Context size and setup together, in thousands', () => {
  const contextSize = 47_600 - SETUP_TOKENS.chatgpt

  expect(
    reReadNote({
      attachedTo: claudeReply(contextSize),
      contextSize,
      to: GPT,
    })
  ).toBe(
    'Switching to ChatGPT will re-read ~48k tokens of this conversation (uses more of your limit).'
  )
})

it('shows from about 20k tokens, setup included, and not below', () => {
  const below = RE_READ_NOTE_FROM - SETUP_TOKENS.chatgpt - 1
  const from = below + 1

  expect(
    reReadNote({attachedTo: claudeReply(below), contextSize: below, to: GPT})
  ).toBeNull()
  expect(
    reReadNote({attachedTo: claudeReply(from), contextSize: from, to: GPT})
  ).not.toBeNull()
})

it('says nothing on the Thread’s own Provider, at the root, or with no Context size to go by', () => {
  const reply = claudeReply(100_000)

  expect(
    reReadNote({
      attachedTo: reply,
      contextSize: 100_000,
      to: {provider: 'claude', model: 'opus'},
    })
  ).toBeNull()
  expect(
    reReadNote({attachedTo: null, contextSize: 100_000, to: GPT})
  ).toBeNull()
  expect(reReadNote({attachedTo: reply, contextSize: null, to: GPT})).toBeNull()
  expect(
    reReadNote({attachedTo: reply, contextSize: 100_000, to: null})
  ).toBeNull()
})

it('takes the Context size of the nearest Reply above that has one', () => {
  const root = exchange(null, 30_000)
  const middle = exchange(root.reply.id, 45_000)
  const stopped = exchange(middle.reply.id, null)

  const index = indexTurns({
    prompts: [root.prompt, middle.prompt, stopped.prompt],
    replies: [root.reply, middle.reply, stopped.reply],
  })

  expect(contextSizeAt(index, stopped.reply)).toBe(45_000)
  expect(contextSizeAt(index, root.reply)).toBe(30_000)
  expect(contextSizeAt(index, null)).toBeNull()
})

it('has no Context size when no Reply on the Thread has one', () => {
  const root = exchange(null, null)
  const index = indexTurns({prompts: [root.prompt], replies: [root.reply]})

  expect(contextSizeAt(index, root.reply)).toBeNull()
})

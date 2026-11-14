import type {Attachment, AttachmentMediaType} from '@uz/contract/attachments'
import type {ProviderId} from '@uz/contract/providers'
import type {Prompt, Reply} from '@uz/contract/turns'

import {expect, it} from 'vitest'

import {pdfNote, pdfsSentAsText} from './pdf-note'
import {indexTurns} from './tree'

const treeId = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'
const createdAt = '2026-10-19T12:00:00.000Z'

const GPT = {provider: 'chatgpt', model: 'gpt-6-sol'} as const
const CLAUDE = {provider: 'claude', model: 'opus'} as const

function file(mediaType: AttachmentMediaType): Attachment {
  return {id: crypto.randomUUID(), name: 'file', mediaType, size: 1000}
}

const PDF = 'application/pdf'

interface Exchange {
  prompt: Prompt
  reply: Reply
}

function exchange(
  parent: Exchange | null,
  provider: ProviderId,
  attachments: Attachment[]
): Exchange {
  const prompt: Prompt = {
    id: crypto.randomUUID(),
    treeId,
    parentReplyId: parent?.reply.id ?? null,
    text: 'Hi',
    attachments,
    createdAt,
  }

  return {
    prompt,
    reply: {
      id: crypto.randomUUID(),
      treeId,
      promptId: prompt.id,
      provider,
      model: provider === 'claude' ? 'opus' : 'gpt-6-sol',
      status: 'complete',
      content: [],
      contextSize: null,
      contextWindow: null,
      failure: null,
      compacted: false,
      rebuilt: false,
      createdAt,
    },
  }
}

function indexOf(...exchanges: Exchange[]) {
  return indexTurns({
    prompts: exchanges.map(({prompt}) => prompt),
    replies: exchanges.map(({reply}) => reply),
  })
}

it('counts the draft’s PDFs, and none of its other files, going to a Provider that takes no PDF as is', () => {
  expect(
    pdfsSentAsText({
      index: indexOf(),
      attachedTo: null,
      attached: [file(PDF), file('image/png'), file('text/plain'), file(PDF)],
      to: GPT,
    })
  ).toBe(2)
})

it('counts none going to a Provider that takes PDFs, or before a Model is picked', () => {
  const root = exchange(null, 'chatgpt', [file(PDF)])

  for (const to of [CLAUDE, null]) {
    expect(
      pdfsSentAsText({
        index: indexOf(root),
        attachedTo: root.reply,
        attached: [file(PDF)],
        to,
      })
    ).toBe(0)
  }
})

it('counts every PDF on the Thread above as well when the Thread is handed over, and none off it', () => {
  const root = exchange(null, 'claude', [file(PDF), file(PDF)])
  const offThread = exchange(root, 'claude', [file(PDF)])
  const next = exchange(root, 'claude', [file('image/png'), file(PDF)])

  expect(
    pdfsSentAsText({
      index: indexOf(root, offThread, next),
      attachedTo: next.reply,
      attached: [file(PDF)],
      to: GPT,
    })
  ).toBe(4)
})

it('leaves the Thread’s PDFs out while the Thread stays on its Provider, which has them already', () => {
  const root = exchange(null, 'chatgpt', [file(PDF)])

  expect(
    pdfsSentAsText({
      index: indexOf(root),
      attachedTo: root.reply,
      attached: [file(PDF)],
      to: GPT,
    })
  ).toBe(1)
})

it('says how many PDFs go as text, one in the singular, and nothing for none', () => {
  expect(pdfNote(1)).toBe('1 PDF sent as text (layout and images not included)')
  expect(pdfNote(3)).toBe(
    '3 PDFs sent as text (layout and images not included)'
  )
  expect(pdfNote(0)).toBeNull()
})

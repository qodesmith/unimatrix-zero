import type {Thread} from '@uz/contract/host'

import {expect, it} from 'vitest'

import {replayed, replyText} from './main'

const searched: Thread[number] = {
  prompt: 'Which river is longest?',
  reply: [
    {type: 'text', text: 'Let me check.'},
    {
      type: 'tool-call',
      toolCallId: 'call-1',
      toolName: 'search',
      args: '{"query":"longest river"}',
      result: {content: 'The Nile, by most counts.', isError: false},
    },
    {type: 'text', text: 'The Nile.'},
  ],
  label: null,
}

it('gives a tool call and its result as plain text, in the Reply’s order', () => {
  expect(replyText(searched)).toBe(
    [
      'Let me check.',
      '[Tool call: search]\n{"query":"longest river"}\n[Tool result]\nThe Nile, by most counts.',
      'The Nile.',
    ].join('\n\n')
  )
})

it('says when a tool failed, and leaves out the result of a call that got none', () => {
  const [, call] = searched.reply

  if (call?.type !== 'tool-call') throw new Error('Not a tool call')

  expect(
    replyText({
      ...searched,
      reply: [
        {...call, result: {content: 'Timed out.', isError: true}},
        {...call, result: null},
      ],
    })
  ).toBe(
    [
      '[Tool call: search]\n{"query":"longest river"}\n[Tool error]\nTimed out.',
      '[Tool call: search]\n{"query":"longest river"}',
    ].join('\n\n')
  )
})

it('puts the label before the text of a Reply another Model wrote, and labels no empty Reply', () => {
  const label = '[Reply written by GPT-6 Sol]'

  expect(
    replyText({prompt: 'Hi', reply: [{type: 'text', text: 'Hello.'}], label})
  ).toBe('[Reply written by GPT-6 Sol]\n\nHello.')
  expect(replyText({prompt: 'Hi', reply: [], label})).toBe('')
})

it('replays the whole Thread in order before the Prompt, without a Reply that showed nothing', () => {
  const text = replayed(
    [
      {
        prompt: 'Name a color.',
        reply: [{type: 'text', text: 'Teal.'}],
        label: '[Reply written by GPT-6 Sol]',
      },
      {prompt: 'And an animal?', reply: [], label: null},
      {
        prompt: 'Still there?',
        reply: [{type: 'text', text: 'Otter.'}],
        label: null,
      },
    ],
    'List both.'
  )

  expect(text.slice(text.indexOf('\n<thread>') + 1)).toBe(
    [
      '<thread>',
      '<prompt>\nName a color.\n</prompt>',
      '<reply>\n[Reply written by GPT-6 Sol]\n\nTeal.\n</reply>',
      '<prompt>\nAnd an animal?\n</prompt>',
      '<prompt>\nStill there?\n</prompt>',
      '<reply>\nOtter.\n</reply>',
      '</thread>',
      '',
      'List both.',
    ].join('\n')
  )
})

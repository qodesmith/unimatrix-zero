import type {HostAttachment} from '@uz/contract/attachments'
import type {Thread} from '@uz/contract/host'

import {expect, it} from 'vitest'

import {explainingLabels, replayed, replyText} from './main'

const searched: Thread[number] = {
  prompt: 'Which river is longest?',
  attachments: [],
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
    replyText({
      prompt: 'Hi',
      attachments: [],
      reply: [{type: 'text', text: 'Hello.'}],
      label,
    })
  ).toBe('[Reply written by GPT-6 Sol]\n\nHello.')
  expect(replyText({prompt: 'Hi', attachments: [], reply: [], label})).toBe('')
})

it('replays the whole Thread in order before the Prompt, without a Reply that showed nothing', () => {
  const [replay, ...rest] = replayed(
    [
      {
        prompt: 'Name a color.',
        attachments: [],
        reply: [{type: 'text', text: 'Teal.'}],
        label: '[Reply written by GPT-6 Sol]',
      },
      {prompt: 'And an animal?', attachments: [], reply: [], label: null},
      {
        prompt: 'Still there?',
        attachments: [],
        reply: [{type: 'text', text: 'Otter.'}],
        label: null,
      },
    ],
    {text: 'List both.', attachments: []}
  )

  if (replay?.type !== 'text') throw new Error('The replay starts with a file')

  const {text} = replay

  expect(rest).toEqual([])
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

function attached(
  name: string,
  mediaType: HostAttachment['mediaType']
): HostAttachment {
  return {
    name,
    mediaType,
    sha256: 'a'.repeat(64),
    path: `/attachments/${name}`,
  }
}

it('puts each Prompt’s files inside its own <prompt>, in order and before its text, and the next Prompt’s before it', () => {
  const report = attached('report.pdf', 'application/pdf')
  const chart = attached('chart.png', 'image/png')
  const notes = attached('notes.txt', 'text/plain')

  const pieces = replayed(
    [
      {
        prompt: 'Sum these up.',
        attachments: [report, chart],
        reply: [{type: 'text', text: 'Done.'}],
        label: null,
      },
      {prompt: '', attachments: [notes], reply: [], label: null},
    ],
    {text: 'And these?', attachments: [chart, notes]}
  )

  expect(pieces).toEqual([
    {type: 'text', text: expect.stringMatching(/\n\n<thread>\n<prompt>$/u)},
    {type: 'file', file: report},
    {type: 'file', file: chart},
    {
      type: 'text',
      text: 'Sum these up.\n</prompt>\n<reply>\nDone.\n</reply>\n<prompt>',
    },
    {type: 'file', file: notes},
    {type: 'text', text: '</prompt>\n</thread>\n'},
    {type: 'file', file: chart},
    {type: 'file', file: notes},
    {type: 'text', text: 'And these?'},
  ])
})

it('adds one line explaining the labels after the user’s System prompt, only when a Reply has one', () => {
  const labeled: Thread = [
    {
      prompt: 'Hi',
      attachments: [],
      reply: [],
      label: '[Reply written by GPT-6 Sol]',
    },
    {
      prompt: 'Again',
      attachments: [],
      reply: [],
      label: '[Reply written by GPT-6 Sol]',
    },
  ]

  const unlabeled: Thread = [
    {prompt: 'Hi', attachments: [], reply: [], label: null},
  ]

  const explained = explainingLabels('Be brief.', labeled)
  const [own, line, ...rest] = explained.split('\n\n')

  expect(own).toBe('Be brief.')
  expect(line).toContain('[Reply written by')
  expect(rest).toEqual([])
  expect(explainingLabels('', labeled)).toBe(line)
  expect(explainingLabels('Be brief.', unlabeled)).toBe('Be brief.')
})

import type {HostAttachment} from '@uz/contract/attachments'
import type {Thread} from '@uz/contract/host'

import {readContent} from '#modules/prompt-content/main'
import {PNG_BASE64, attachedFiles} from '#modules/test-attachments/main'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {expect, it, onTestFinished} from 'vitest'

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

const report: HostAttachment = {
  name: 'report.pdf',
  path: '/attachments/report.pdf',
  folder: false,
  inline: {type: 'pdf'},
}

const chart: HostAttachment = {
  name: 'chart.png',
  path: '/attachments/chart.png',
  folder: false,
  inline: {
    type: 'image',
    mediaType: 'image/png',
    path: '/attachments/chart.png',
  },
}

const dropped: HostAttachment = {
  name: 'old.pdf',
  path: '/attachments/old.pdf',
  folder: false,
  inline: null,
}

const project: HostAttachment = {
  name: 'project',
  path: '/work/project',
  folder: true,
  inline: null,
}

it('puts each earlier Prompt’s files inside its own <prompt>, in order and before its text, to be read when the content is, and the Prompt’s own path lines after the Thread, each inline file right after its own line', () => {
  const pieces = replayed(
    [
      {
        prompt: 'Sum these up.',
        attachments: [report, chart],
        reply: [{type: 'text', text: 'Done.'}],
        label: null,
      },
      {prompt: '', attachments: [dropped, project], reply: [], label: null},
    ],
    {text: 'And these?', attachments: [chart, project]}
  )

  expect(pieces).toEqual([
    {
      type: 'text',
      text: expect.stringMatching(/\n\n<thread>\n<prompt>$/u),
    },
    {type: 'earlier-file', file: report},
    {type: 'earlier-file', file: chart},
    {
      type: 'text',
      text: [
        'Sum these up.',
        '</prompt>',
        '<reply>\nDone.\n</reply>',
        '<prompt>',
      ].join('\n'),
    },
    {type: 'earlier-file', file: dropped},
    {
      type: 'text',
      text: [
        '[Attached folder "project" is at: /work/project]',
        '</prompt>',
        '</thread>',
        '',
        '[Attached file "chart.png" is saved at: /attachments/chart.png]',
      ].join('\n'),
    },
    {type: 'file', file: chart},
    {
      type: 'text',
      text: '[Attached folder "project" is at: /work/project]\nAnd these?',
    },
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

it('reads each earlier file afresh, and tells the AI of each it can no longer read in place of its path, inline or by path only; an earlier image whose shrunk copy is gone goes by its path only', async () => {
  const made = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-replay-'))
  onTestFinished(() => fs.rmSync(made, {recursive: true, force: true}))
  const {gone, chart: kept, photo, archive} = attachedFiles(made)
  fs.rmSync(photo.inline.path)
  fs.rmSync(archive.path)

  const content = await readContent(
    replayed(
      [
        {
          prompt: 'Look.',
          attachments: [gone, kept, photo, archive],
          reply: [],
          label: null,
        },
      ],
      {text: 'Next.', attachments: []}
    )
  )

  expect(content).toEqual([
    {
      type: 'text',
      text: expect.stringMatching(
        /<prompt>\n\[Attached file "gone\.txt" can no longer be read\]\n\[Attached file "chart\.png" is saved at: .+\]$/u
      ),
    },
    {type: 'image', mediaType: 'image/png', base64: PNG_BASE64},
    {
      type: 'text',
      text: [
        `[Attached file "photo.jpg" is saved at: ${photo.path}]`,
        '[Attached file "archive.zip" can no longer be read]',
        'Look.',
        '</prompt>',
        '</thread>',
        '',
        'Next.',
      ].join('\n'),
    },
  ])
})

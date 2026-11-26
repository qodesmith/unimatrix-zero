import type {Received} from './asking'
import type {ApprovalRequest} from './wire'
import type {ApprovalGrant} from '@uz/contract/permissions'

import {createApprovals} from '#modules/approvals/main'
import {ReplyRequestSchema} from '@uz/contract/host'
import {DEFAULT_TREE_TOOLS} from '@uz/contract/tools'
import {expect, it} from 'vitest'

import {createTurnAsking} from './asking'

const THREAD = 'thread-1'

const WRAPPED = "/bin/zsh -lc 'touch made.txt'"
const PLAIN_GRANT: ApprovalGrant = {kind: 'command', command: 'touch made.txt'}
const OUTSIDE_GRANT: ApprovalGrant = {...PLAIN_GRANT, outsideSandbox: true}

const REASON = 'Do you want to run this outside the Sandbox?'

type CommandParams = Extract<
  ApprovalRequest,
  {method: 'item/commandExecution/requestApproval'}
>['params']

function setUp(grants: ApprovalGrant[] = []) {
  const responses: unknown[] = []
  const shown: Extract<Received, {method: 'shown'}>['event'][] = []
  const taking: ((request: ApprovalRequest) => boolean)[] = []
  let nextId = 0

  const asking = createTurnAsking({
    server: {
      respond: (id, result) => responses.push({id, result}),
      takeApprovals(listener) {
        taking.push(listener)

        return () => true
      },
    },
    approvals: createApprovals(),
    request: ReplyRequestSchema.parse({
      treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
      replyId: '01a16096-00ad-7d3b-8205-6b76ddc26ce1',
      model: 'gpt-5',
      systemPrompt: '',
      prompt: {
        text: 'hi',
        attachments: [],
        messageId: '01a16096-00ad-7d3b-8205-6b76ddc26ce2',
      },
      vendorProgram: {program: null, configDir: '/config'},
      treeFolder: '/tree',
      session: null,
      thread: [],
      compactionSettings: {auto: true, threshold: null},
      systemPromptChanged: false,
      tools: DEFAULT_TREE_TOOLS,
      permissionMode: 'supervised',
      hiddenFolders: [],
      treesFolder: '/trees',
      grants,
    }),
    threadId: THREAD,
    push(received) {
      if (received.method === 'shown') shown.push(received.event)
      else asking.took(received)
    },
  })

  return {
    responses,
    /** Codex asks before a command; returns the request's id. */
    command(params: Partial<CommandParams>) {
      nextId += 1

      const request: ApprovalRequest = {
        id: nextId,
        method: 'item/commandExecution/requestApproval',
        params: {
          threadId: THREAD,
          turnId: 'turn-1',
          itemId: `item-${nextId}`,
          command: WRAPPED,
          ...params,
        },
      }

      for (const take of taking) take(request)

      return nextId
    },
    cards: () =>
      shown.flatMap(event =>
        event.type === 'APPROVAL_REQUESTED' ? [event.action] : []
      ),
  }
}

it('shows a command that asks to leave the Sandbox as the outside form, without its shell', () => {
  const codex = setUp()

  codex.command({})
  codex.command({reason: ''})
  codex.command({reason: REASON})

  expect(codex.cards()).toEqual([
    {kind: 'command', command: 'touch made.txt'},
    {kind: 'command', command: 'touch made.txt'},
    {kind: 'command', command: 'touch made.txt', outsideSandbox: true},
  ])
})

it('asks before a granted command leaves the Sandbox', () => {
  const codex = setUp([PLAIN_GRANT])

  codex.command({reason: REASON})

  expect(codex.cards()).toEqual([OUTSIDE_GRANT])
})

it('asks before a command inside the Sandbox whose grant is for outside it', () => {
  const codex = setUp([OUTSIDE_GRANT])

  codex.command({})

  expect(codex.cards()).toEqual([PLAIN_GRANT])
})

it('runs a command outside the Sandbox with no card once that form is granted', async () => {
  const codex = setUp([OUTSIDE_GRANT])

  const id = codex.command({reason: REASON})

  await expect
    .poll(() => codex.responses)
    .toEqual([{id, result: {decision: 'accept'}}])
  expect(codex.cards()).toEqual([])
})

it('keeps a host request a host card, whatever its reason', () => {
  const codex = setUp()

  codex.command({
    reason: REASON,
    networkApprovalContext: {host: 'example.com'},
  })

  expect(codex.cards()).toEqual([{kind: 'host', host: 'example.com'}])
})

it('runs a read with no card, but asks before one that would leave the Sandbox', async () => {
  const codex = setUp()

  const read = {
    command: '/bin/zsh -lc ls',
    commandActions: [{type: 'listFiles'}],
  }

  const id = codex.command(read)

  await expect
    .poll(() => codex.responses)
    .toEqual([{id, result: {decision: 'accept'}}])
  expect(codex.cards()).toEqual([])

  codex.command({...read, reason: REASON})

  expect(codex.cards()).toEqual([
    {kind: 'command', command: 'ls', outsideSandbox: true},
  ])
})

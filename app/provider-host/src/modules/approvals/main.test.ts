import type {ApprovalEvent} from './main'
import type {ApprovalAction} from '@uz/contract/permissions'

import {expect, it} from 'vitest'

import {createApprovals} from './main'

const TREE = '01a16096-00ad-7d3b-8205-6b76ddc26ce0'
const OTHER_TREE = '01a16096-00ad-7d3b-8205-6b76ddc26ce1'

const WRITE: ApprovalAction = {
  kind: 'edit',
  paths: ['/tree/notes.txt'],
  inTreeFiles: true,
}

const COMMAND: ApprovalAction = {kind: 'command', command: 'touch made.txt'}

function replyIn(treeId: string, replyId = 'reply-1') {
  return {treeId, replyId, grants: []}
}

function setUp() {
  const approvals = createApprovals()
  const events: ApprovalEvent[] = []

  return {
    approvals,
    events,
    reply: (treeId = TREE, replyId = 'reply-1') =>
      approvals.forReply(replyIn(treeId, replyId), event => {
        events.push(event)
      }),
    requested: () =>
      events.flatMap(event =>
        event.type === 'APPROVAL_REQUESTED' ? [event] : []
      ),
  }
}

it('asks, and goes ahead once allowed', async () => {
  const {approvals, events, reply, requested} = setUp()

  const asked = reply().ask({action: WRITE, toolCallId: 'tool-1'})
  const [request] = requested()

  expect(request).toMatchObject({
    type: 'APPROVAL_REQUESTED',
    treeId: TREE,
    replyId: 'reply-1',
    toolCallId: 'tool-1',
    action: WRITE,
  })

  approvals.answer(request?.approvalId ?? '', 'allow-once')

  await expect(asked).resolves.toBe(true)
  expect(events.at(-1)).toEqual({
    type: 'APPROVAL_RESOLVED',
    treeId: TREE,
    replyId: 'reply-1',
    approvalId: request?.approvalId,
    answer: 'allow-once',
  })
})

it('does not go ahead once denied', async () => {
  const {approvals, reply, requested} = setUp()

  const asked = reply().ask({action: COMMAND})
  approvals.answer(requested()[0]?.approvalId ?? '', 'deny')

  await expect(asked).resolves.toBe(false)
})

it('asks once allowed only once', async () => {
  const {approvals, reply, requested} = setUp()
  const replying = reply()

  const first = replying.ask({action: COMMAND})
  approvals.answer(requested()[0]?.approvalId ?? '', 'allow-once')
  await first
  void replying.ask({action: COMMAND})

  expect(requested()).toHaveLength(2)
})

it('goes ahead without asking after an always-allow, in every Reply of the Tree', async () => {
  const {approvals, reply, requested} = setUp()

  const first = reply().ask({action: WRITE})
  approvals.answer(requested()[0]?.approvalId ?? '', 'always-allow')
  await first

  await expect(reply().ask({action: WRITE})).resolves.toBe(true)
  await expect(
    reply(TREE, 'reply-2').ask({
      action: {kind: 'edit', paths: ['/tree/other.txt'], inTreeFiles: true},
    })
  ).resolves.toBe(true)
  expect(requested()).toHaveLength(1)
})

it('keeps an always-allow to its own Tree', async () => {
  const {approvals, reply, requested} = setUp()

  const first = reply().ask({action: COMMAND})
  approvals.answer(requested()[0]?.approvalId ?? '', 'always-allow')
  await first
  void reply(OTHER_TREE).ask({action: COMMAND})

  expect(requested()).toHaveLength(2)
})

it('goes ahead without asking when the request carries a grant', async () => {
  const {approvals, events} = setUp()

  const replying = approvals.forReply(
    {...replyIn(TREE), grants: [{kind: 'command', command: 'touch made.txt'}]},
    event => {
      events.push(event)
    }
  )

  await expect(replying.ask({action: COMMAND})).resolves.toBe(true)
  expect(events).toEqual([])
})

it('names the Subagent asking', () => {
  const {reply, requested} = setUp()

  void reply().ask({action: COMMAND, subagentId: 'agent-1'})

  expect(requested()[0]?.subagentId).toBe('agent-1')
})

it('drops a card the Reply stops under, as a denial with no answer shown', async () => {
  const {approvals, events, reply, requested} = setUp()
  const stop = new AbortController()

  const asked = reply().ask({action: COMMAND, signal: stop.signal})
  const {approvalId = ''} = requested()[0] ?? {}
  stop.abort()

  await expect(asked).resolves.toBe(false)

  approvals.answer(approvalId, 'allow-once')

  expect(events.map(event => event.type)).toEqual(['APPROVAL_REQUESTED'])
})

it('ignores an answer to a card it never showed', () => {
  const {approvals, events} = setUp()

  approvals.answer('no-such-card', 'allow-once')

  expect(events).toEqual([])
})

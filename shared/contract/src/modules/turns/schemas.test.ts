import {expect, it} from 'vitest'

import {ReplyEventSchema} from './schemas'

const finished = {
  type: 'RUN_FINISHED',
  treeId: '01a16096-00ad-7d3b-8205-6b76ddc26ce0',
  replyId: '01a16096-00ae-7d3b-8205-6b76ddc26ce0',
  status: 'complete',
}

it('refuses a RUN_FINISHED from a Subagent', () => {
  expect(ReplyEventSchema.safeParse(finished).success).toBe(true)
  expect(
    ReplyEventSchema.safeParse({...finished, subagentId: 's1'}).success
  ).toBe(false)
})

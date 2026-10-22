import {readFile} from 'node:fs/promises'
import {expect, it} from 'vitest'

import {FAKE_REPLY_RECORDING, recordFakeReply} from './main'

it('matches the recording the window replays in its tests', async () => {
  const recorded = JSON.parse(await readFile(FAKE_REPLY_RECORDING, 'utf8'))

  expect(
    recorded,
    'The fake Reply changed: run `bun run --filter @uz/provider-host record-fake-reply`'
  ).toEqual(await recordFakeReply())
})

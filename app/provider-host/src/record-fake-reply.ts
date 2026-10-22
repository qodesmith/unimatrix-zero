/**
 * Writes the fake driver's complete Reply where the window's tests replay it.
 * Run after changing the fake Reply: `bun run record-fake-reply`.
 */
import {
  FAKE_REPLY_RECORDING,
  recordFakeReply,
} from '#modules/fake-reply-recording/main'
import {writeFile} from 'node:fs/promises'

const events = await recordFakeReply()

await writeFile(FAKE_REPLY_RECORDING, `${JSON.stringify(events, null, 2)}\n`)

/** Run after changing the fake Reply: `bun run record-fake-reply`. */
import {writeFile} from 'node:fs/promises'

import {FAKE_REPLY_RECORDING, recordFakeReply} from './fake-reply'

const events = await recordFakeReply()

await writeFile(FAKE_REPLY_RECORDING, `${JSON.stringify(events, null, 2)}\n`)

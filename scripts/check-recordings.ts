import path from 'node:path'

import {finishCheck} from './finish-check.ts'
import {filesIn, isLiveTest, isRecording, problemsOf} from './recordings.ts'
import {HOST_PACKAGE, MANIFEST, pinsOf} from './vendor-pins.ts'

const root = path.resolve(import.meta.dirname, '..')

async function read(file: string) {
  return Bun.file(path.join(root, file)).text()
}

const files = await filesIn(root)

const recordings = await Promise.all(
  files.filter(isRecording).map(async file => ({file, text: await read(file)}))
)

const liveTests = await Promise.all(
  files.filter(isLiveTest).map(async file => ({file, source: await read(file)}))
)

const pins = pinsOf(await read(MANIFEST), await read(HOST_PACKAGE))

finishCheck(
  problemsOf(recordings, liveTests, pins),
  'The recordings and their live tests or the pins disagree:',
  `All ${recordings.length} recordings come from a live test and the pinned builds.`
)

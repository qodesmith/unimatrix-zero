import {privateDetailsIn} from '#modules/test-recordings/main'
import {once} from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {expect, it} from 'vitest'

import {createRecorder} from './recording'
import {RECORDINGS} from './replay'

it('holds no email, home folder, temp folder or account id but the stand-ins in a committed recording', () => {
  expect(
    privateDetailsIn(RECORDINGS, [
      'user@example.com',
      '/Users/sam',
      '00000000-0000-4000-8000-000000000000',
    ])
  ).toEqual([])
})

it('writes nothing for a codex that exits after a newer recorder claimed its file, which the newer one writes with its build', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-recorder-'))
  const file = path.join(folder, 'retried.ndjson')

  const env = Object.fromEntries(
    Object.entries(process.env).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, value]]
    )
  )

  // Stands in for `codex`: prints a version, and exits once its input ends.
  function start(recorder: ReturnType<typeof createRecorder>) {
    return recorder.spawn(
      {command: process.execPath, args: ['-e', 'process.stdin.resume()']},
      {cwd: folder, env}
    )
  }

  try {
    const stale = start(createRecorder([file]))
    const fresh = start(createRecorder([file]))

    fresh.stdin.end()
    await once(fresh, 'exit')

    expect(
      JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0] ?? '')
    ).toEqual({kind: 'start', build: expect.stringMatching(/^codex \d/)})

    fs.rmSync(file)
    stale.stdin.end()
    await once(stale, 'exit')

    expect(fs.existsSync(file)).toBe(false)
  } finally {
    fs.rmSync(folder, {recursive: true, force: true})
  }
})

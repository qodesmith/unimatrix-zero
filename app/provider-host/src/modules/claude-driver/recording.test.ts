import {privateDetailsIn} from '#modules/test-recordings/main'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {expect, it} from 'vitest'

import {createRecorder} from './recording'
import {RECORDINGS} from './replay'

it('holds no email, home folder, temp folder or account id but the stand-ins in a committed recording', () => {
  expect(
    privateDetailsIn(RECORDINGS, [
      'sam@example.com',
      '/Users/sam',
      '-Users-sam',
      '00000000-0000-4000-8000-000000000000',
      // Claude Code's commit attribution, which every session carries.
      'noreply@anthropic.com',
    ])
  ).toEqual([])
})

it('writes nothing for a claude that exits after a newer recorder claimed its file, which the newer one writes with its build', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-recorder-'))
  const file = path.join(folder, 'retried.ndjson')

  // Stands in for `claude`: prints a version, and exits once its input ends.
  const standIn = {
    command: process.execPath,
    args: ['-e', 'process.stdin.resume()'],
    env: {},
    signal: new AbortController().signal,
  }

  function start(from: ReturnType<typeof createRecorder>) {
    return from.spawn(standIn)
  }

  function recorder() {
    return createRecorder(
      ({command, args}) => spawn(command, args, {stdio: 'pipe'}),
      [file]
    )
  }

  try {
    const older = recorder()
    const stale = start(older)
    const newer = recorder()

    start(newer).stdin.end()
    await newer.done()

    expect(
      JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0] ?? '')
    ).toEqual(
      expect.objectContaining({
        kind: 'start',
        build: expect.stringMatching(/^claude \d/),
      })
    )

    fs.rmSync(file)
    stale.stdin.end()
    await older.done()

    expect(fs.existsSync(file)).toBe(false)
  } finally {
    fs.rmSync(folder, {recursive: true, force: true})
  }
})

import {privateDetailsIn} from '#modules/test-recordings/main'
import {spawn} from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {expect, it} from 'vitest'

import {claudeReplyEnvironment} from './environment'
import {createRecorder} from './recording'
import {CONFIG_FOLDER_STAND_IN, RECORDINGS, RecordedLineSchema} from './replay'

it('holds no email, home folder, temp folder or account id but the stand-ins in a committed recording', () => {
  expect(
    privateDetailsIn(RECORDINGS, [
      'sam@example.com',
      '/Users/sam',
      '-Users-sam',
      '00000000-0000-4000-8000-000000000000',
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
      [file],
      folder
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

it('records the variables the app gave claude and none of the host’s, naming the config folder by its stand-in', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-recorder-'))
  const file = path.join(folder, 'started.ndjson')

  const recorder = createRecorder(
    ({command, args}) => spawn(command, args, {stdio: 'pipe'}),
    [file],
    folder
  )

  try {
    recorder
      .spawn({
        command: process.execPath,
        args: ['-e', 'process.stdin.resume()'],
        env: {
          ...claudeReplyEnvironment({PATH: '/usr/bin'}, folder),
          CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
        },
        signal: new AbortController().signal,
      })
      .stdin.end()
    await recorder.done()

    const [start] = fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => RecordedLineSchema.parse(JSON.parse(line)))

    expect(start?.kind === 'start' && start.env).toEqual({
      ...claudeReplyEnvironment({}, CONFIG_FOLDER_STAND_IN),
      CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
    })
  } finally {
    fs.rmSync(folder, {recursive: true, force: true})
  }
})

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

const env = Object.fromEntries(
  Object.entries(process.env).flatMap(([name, value]) =>
    value === undefined ? [] : [[name, value]]
  )
)

function start(recorder: ReturnType<typeof createRecorder>, cwd: string) {
  return recorder.spawn(
    {command: process.execPath, args: ['-e', 'process.stdin.resume()']},
    {cwd, env}
  )
}

it('writes nothing for a codex that exits after a newer recorder claimed its file, which the newer one writes with its build', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-recorder-'))
  const file = path.join(folder, 'retried.ndjson')

  try {
    const stale = start(createRecorder([file]), folder)
    const fresh = start(createRecorder([file]), folder)

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

it('names the Sandbox folders a live test gave it on the start line, each other Tree by name and each hidden folder under its stand-in', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-recorder-'))
  const file = path.join(folder, 'sandboxed.ndjson')
  const treesFolder = path.join(folder, 'trees')
  const hidden = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-recorder-hidden-'))

  for (const name of ['one', 'three', 'two']) {
    fs.mkdirSync(path.join(treesFolder, name), {recursive: true})
  }

  try {
    const codex = start(
      createRecorder([file], {
        treeFolder: path.join(treesFolder, 'two'),
        treesFolder,
        hiddenFolders: [hidden],
      }),
      folder
    )

    codex.stdin.end()
    await once(codex, 'exit')

    expect(
      JSON.parse(fs.readFileSync(file, 'utf8').split('\n')[0] ?? '')
    ).toMatchObject({
      sandbox: {
        otherTrees: ['one', 'three'],
        hiddenFolders: [`/temp-folder${path.sep}${path.basename(hidden)}`],
      },
    })
  } finally {
    fs.rmSync(hidden, {recursive: true, force: true})
    fs.rmSync(folder, {recursive: true, force: true})
  }
})

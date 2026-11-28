import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {promisify} from 'node:util'
import {describe, expect, it} from 'vitest'

import {
  filesChangedSince,
  liveTestsReached,
  reRunCauses,
} from './changes-since.ts'

const ROOT = path.resolve(import.meta.dirname, '..')

const CLAUDE = 'app/provider-host/src/modules/claude-driver'
const CODEX = 'app/provider-host/src/modules/codex-driver'

describe('what a push since a result needs', () => {
  it('a new run for a live test, a recording, a vendor pin, the lockfile or a file a live test imports, and nothing for the rest', () => {
    const causes = reRunCauses(
      [
        `${CLAUDE}/streaming.live.test.ts`,
        `${CODEX}/recordings/started.ndjson`,
        'app/main/src/modules/vendor-programs/dev-manifest.json',
        'app/provider-host/package.json',
        'bun.lock',
        `${CLAUDE}/transcripts.ts`,
        `${CLAUDE}/streaming.test.ts`,
        'docs/provider-dependencies.md',
        '.github/workflows/ci.yml',
      ],
      new Map([
        [
          `${CLAUDE}/streaming.live.test.ts`,
          [`${CLAUDE}/streaming.live.test.ts`],
        ],
        [
          'app/provider-host/package.json',
          [
            `${CLAUDE}/streaming.live.test.ts`,
            `${CODEX}/streaming.live.test.ts`,
          ],
        ],
        [`${CLAUDE}/transcripts.ts`, [`${CLAUDE}/streaming.live.test.ts`]],
      ])
    )

    expect(causes).toEqual([
      {file: `${CLAUDE}/streaming.live.test.ts`, why: 'a live test'},
      {file: `${CODEX}/recordings/started.ndjson`, why: 'a recording'},
      {
        file: 'app/main/src/modules/vendor-programs/dev-manifest.json',
        why: 'a vendor pin',
      },
      {file: 'app/provider-host/package.json', why: 'a vendor pin'},
      {file: 'bun.lock', why: 'the lockfile'},
      {
        file: `${CLAUDE}/transcripts.ts`,
        why: `imported by ${CLAUDE}/streaming.live.test.ts`,
      },
    ])
  })
})

const execFileAsync = promisify(execFile)

async function repo() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'changes-since-'))

  async function run(...args: string[]) {
    const {stdout} = await execFileAsync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args],
      {cwd: root}
    )

    return stdout.trim()
  }

  async function commit(files: Record<string, string>, gone: string[] = []) {
    await Promise.all(
      Object.entries(files).map(async ([file, text]) =>
        fs.writeFile(path.join(root, file), text)
      )
    )
    await Promise.all(gone.map(async file => fs.rm(path.join(root, file))))
    await run('add', '--all')
    await run('commit', '--quiet', '--message', 'x')

    return run('rev-parse', 'HEAD')
  }

  await run('init', '--quiet')

  return {root, run, commit}
}

describe('the files changed since a result', () => {
  it('lists each file changed after the result’s commit, a moved file under both names', async () => {
    const {root, commit} = await repo()
    const from = await commit({'a.ts': '1', 'old.ts': 'kept', 'same.ts': ''})
    await commit({'a.ts': '2'})
    const head = await commit({'new.ts': 'kept'}, ['old.ts'])

    expect(await filesChangedSince(root, from, head)).toEqual({
      ancestor: true,
      files: ['a.ts', 'new.ts', 'old.ts'],
    })
  })

  it('finds no ancestor in a commit a force-push dropped, or one the checkout never fetched', async () => {
    const {root, run, commit} = await repo()
    const base = await commit({'a.ts': '1'})
    const dropped = await commit({'a.ts': '2'})
    await run('reset', '--quiet', '--hard', base)
    const head = await commit({'a.ts': '3'})

    expect(await filesChangedSince(root, dropped, head)).toEqual({
      ancestor: false,
    })
    expect(await filesChangedSince(root, 'f'.repeat(40), head)).toEqual({
      ancestor: false,
    })
  })
})

describe('the live tests a change reaches', () => {
  it('are each live test that imports the file at any depth, through Vitest’s own import walk, every live test for the Vitest config, and none for a root package.json or the UI’s Vite config', () => {
    const reached = liveTestsReached(ROOT, [
      `${CLAUDE}/transcripts.ts`,
      'app/provider-host/src/modules/test-recordings/main.ts',
      `${CLAUDE}/streaming.test.ts`,
      'app/renderer/src/modules/canvas/re-read.ts',
      'docs/provider-dependencies.md',
      'package.json',
      'vitest.config.ts',
      'app/renderer/vite.config.ts',
    ])

    const both = [
      `${CLAUDE}/streaming.live.test.ts`,
      `${CODEX}/streaming.live.test.ts`,
    ]

    expect(reached).toEqual(
      new Map([
        [`${CLAUDE}/transcripts.ts`, [`${CLAUDE}/streaming.live.test.ts`]],
        ['app/provider-host/src/modules/test-recordings/main.ts', both],
        ['vitest.config.ts', both],
      ])
    )
  })
})

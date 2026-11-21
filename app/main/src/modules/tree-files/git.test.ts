import os from 'node:os'
import path from 'node:path'
import {expect, inject, it} from 'vitest'

import {createGit} from './git'

it('runs the sub-programs of the app’s own git from inside its own folder', async () => {
  const program = inject('gitProgram')
  const build = path.resolve(program, '..', '..').toLowerCase()
  const git = createGit(program, process.env)

  const execPath = await git({store: os.tmpdir()}, ['--exec-path'])

  expect(path.resolve(execPath.trim()).toLowerCase()).toContain(
    `${build}${path.sep}`
  )
})

it('fails with git’s own message when git ends before reading what it was handed', async () => {
  const git = createGit(inject('gitProgram'), process.env)
  const missing = path.join(os.tmpdir(), 'uz-no-such-store.git')

  await expect(
    git(
      {store: missing},
      ['cat-file', '--batch-check'],
      'x\n'.repeat(1024 * 1024)
    )
  ).rejects.toThrow('not a git repository')
})

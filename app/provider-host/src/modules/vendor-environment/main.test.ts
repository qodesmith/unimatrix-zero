import {NO_LOGIN_HELPER} from '@uz/vendor-program/git-login'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {expect, it, vi} from 'vitest'

import {
  macHasDeveloperTools,
  withAppFolders,
  withDeveloperDir,
  withGitLast,
} from './main'

const base = {PATH: '/usr/bin', HOME: '/Users/sam'}
const folder = '/data/unimatrix-zero/developer'

it('names the app’s developer folder on a Mac with no developer tools, and changes nothing else', async () => {
  const env = await withDeveloperDir(base, folder, async () => false)

  expect(env).toStrictEqual({...base, DEVELOPER_DIR: folder})
})

it('names the app’s developer folder over one the user set that holds no xcrun', async () => {
  const stale = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-stale-developer-'))
  const own = {...base, DEVELOPER_DIR: stale}

  const env = await withDeveloperDir(own, folder, async () => false)

  expect(env).toStrictEqual({...base, DEVELOPER_DIR: folder})
})

function folderWithXcrun(...root: string[]) {
  const theirs = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-own-developer-'))
  const bin = path.join(theirs, ...root, 'usr', 'bin')
  fs.mkdirSync(bin, {recursive: true})
  fs.writeFileSync(path.join(bin, 'xcrun'), '', {mode: 0o755})

  return theirs
}

function theirsWithXcrun(...root: string[]) {
  return {...base, DEVELOPER_DIR: folderWithXcrun(...root)}
}

function xcodeSelectThat(script: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-xcode-select-'))
  const file = path.join(dir, 'xcode-select')
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, {mode: 0o755})

  return file
}

it.skipIf(process.platform === 'win32')(
  'finds developer tools where xcode-select succeeds',
  async () => {
    const prints = xcodeSelectThat('echo /Library/Developer/CommandLineTools')

    expect(await macHasDeveloperTools(base, prints)).toBe(true)
  }
)

it.skipIf(process.platform === 'win32')(
  'finds no developer tools where xcode-select fails',
  async () => {
    expect(await macHasDeveloperTools(base, xcodeSelectThat('exit 2'))).toBe(
      false
    )
  }
)

it('leaves a Mac alone, as one with developer tools, where xcode-select never starts', async () => {
  const missing = path.join(os.tmpdir(), 'uz-no-such-xcode-select')

  expect(await macHasDeveloperTools(base, missing)).toBe(true)
})

it.skipIf(process.platform === 'win32')(
  'leaves a developer folder the user set that holds an xcrun, on a Mac with no developer tools of its own',
  async () => {
    const own = theirsWithXcrun()

    expect(await withDeveloperDir(own, folder, async () => false)).toBe(own)
  }
)

it.skipIf(process.platform === 'win32')(
  'leaves an Xcode app the user set whose developer folder holds an xcrun, on a Mac with no developer tools of its own',
  async () => {
    const own = theirsWithXcrun('Contents', 'Developer')

    expect(await withDeveloperDir(own, folder, async () => false)).toBe(own)
  }
)

it('leaves the environment of a Mac with developer tools as it is', async () => {
  expect(await withDeveloperDir(base, folder, async () => true)).toBe(base)
})

it('looks for no developer tools where main names no folder, as off a Mac', async () => {
  const hasDeveloperTools = vi.fn<() => Promise<boolean>>(async () => false)

  expect(await withDeveloperDir(base, undefined, hasDeveloperTools)).toBe(base)
  expect(hasDeveloperTools).not.toHaveBeenCalled()
})

// Only CI's "A Mac with no developer tools" job sets `UZ_NO_DEVELOPER_TOOLS`.
it.runIf(process.platform === 'darwin')(
  'finds a Mac’s developer tools, and finds none on a Mac without them, whatever DEVELOPER_DIR names',
  async () => {
    const {DEVELOPER_DIR: _own, ...env} = process.env
    const hasTools = process.env.UZ_NO_DEVELOPER_TOOLS !== '1'

    expect(await macHasDeveloperTools(env)).toBe(hasTools)
    expect(
      await macHasDeveloperTools({...env, DEVELOPER_DIR: os.tmpdir()})
    ).toBe(hasTools)
  }
)

it('puts the folder of the app’s own git last on PATH, after every folder of the user’s', () => {
  const gitFolder = path.join('/data', 'unimatrix-zero', 'git')

  expect(withGitLast(base, gitFolder)).toStrictEqual({
    ...base,
    PATH: `/usr/bin${path.delimiter}${gitFolder}`,
  })
})

it('adds to the Path a Windows environment holds, and to no second variable', () => {
  const windows = {Path: String.raw`C:\Windows\System32`, HOME: base.HOME}
  const gitFolder = String.raw`C:\data\vendor\git\cmd`

  expect(withGitLast(windows, gitFolder)).toStrictEqual({
    ...windows,
    Path: `${windows.Path}${path.delimiter}${gitFolder}`,
  })
})

it('leaves PATH alone where main names no folder, as on a Mac', () => {
  expect(withGitLast(base, undefined)).toBe(base)
})

const ownGitSetting = {
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'user.name',
  GIT_CONFIG_VALUE_0: 'Sam',
}

it('turns off git’s login prompts on Windows, and adds its credential helper after the git settings already there', async () => {
  const windows = {Path: String.raw`C:\Windows\System32`, ...ownGitSetting}
  const gitFolder = String.raw`C:\data\vendor\git\cmd`

  const env = await withAppFolders(
    windows,
    {gitFolder},
    async () => true,
    'win32'
  )

  expect(env).toStrictEqual({
    ...windows,
    Path: `${windows.Path}${path.delimiter}${gitFolder}`,
    GCM_INTERACTIVE: 'never',
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_1: 'credential.helper',
    GIT_CONFIG_VALUE_1: NO_LOGIN_HELPER,
  })
})

it('leaves git’s settings alone on Linux', async () => {
  const linux = {...base, ...ownGitSetting}
  const gitFolder = '/data/unimatrix-zero/git'

  const env = await withAppFolders(
    linux,
    {gitFolder},
    async () => true,
    'linux'
  )

  expect(env).toStrictEqual({
    ...linux,
    PATH: `/usr/bin${path.delimiter}${gitFolder}`,
  })
})

it('leaves git’s settings alone on Windows where the manifest has no git', async () => {
  const windows = {Path: String.raw`C:\Windows\System32`}

  expect(await withAppFolders(windows, {}, async () => true, 'win32')).toBe(
    windows
  )
})

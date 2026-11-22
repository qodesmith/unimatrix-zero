import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {expect, it, vi} from 'vitest'

import {macHasDeveloperTools, withDeveloperDir} from './main'

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

/** A folder the user's `DEVELOPER_DIR` names, with an `xcrun` under `root`. */
function theirsWithXcrun(...root: string[]) {
  return {...base, DEVELOPER_DIR: folderWithXcrun(...root)}
}

/** A stand-in for `xcode-select` that runs `script`. */
function xcodeSelectThat(script: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-xcode-select-'))
  const file = path.join(dir, 'xcode-select')
  fs.writeFileSync(file, `#!/bin/sh\n${script}\n`, {mode: 0o755})

  return file
}

it.skipIf(process.platform === 'win32')(
  'finds developer tools where the folder xcode-select prints is there',
  async () => {
    const prints = xcodeSelectThat(`echo "${os.tmpdir()}"`)

    expect(await macHasDeveloperTools(base, prints)).toBe(true)
  }
)

it.skipIf(process.platform === 'win32')(
  'finds no developer tools where the folder xcode-select prints is gone',
  async () => {
    const gone = path.join(os.tmpdir(), 'uz-developer-folder-that-is-gone')
    const prints = xcodeSelectThat(`echo "${gone}"`)

    expect(await macHasDeveloperTools(base, prints)).toBe(false)
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

/**
 * CI's "A Mac with no developer tools" job sets `UZ_NO_DEVELOPER_TOOLS` once
 * it has moved Xcode and the Command Line Tools away; every other Mac that
 * runs the tests has them.
 */
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

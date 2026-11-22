import {expect, it, vi} from 'vitest'

import {macHasDeveloperTools, withDeveloperDir} from './main'

const base = {PATH: '/usr/bin', HOME: '/Users/sam'}
const folder = '/data/unimatrix-zero/developer'

it('names the app’s developer folder on a Mac with no developer tools, and changes nothing else', async () => {
  const hasDeveloperTools = vi.fn<(env: NodeJS.ProcessEnv) => Promise<boolean>>(
    async () => false
  )

  const env = await withDeveloperDir(base, folder, hasDeveloperTools)

  expect(env).toStrictEqual({...base, DEVELOPER_DIR: folder})
  // The user's own `DEVELOPER_DIR` counts as developer tools.
  expect(hasDeveloperTools).toHaveBeenCalledWith(base)
})

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
  'finds a Mac’s developer tools, and finds none on a Mac without them',
  async () => {
    const {DEVELOPER_DIR: _own, ...env} = process.env

    expect(await macHasDeveloperTools(env)).toBe(
      process.env.UZ_NO_DEVELOPER_TOOLS !== '1'
    )
  }
)

it.runIf(process.platform === 'darwin')(
  'takes a developer folder the user names for developer tools',
  async () => {
    expect(
      await macHasDeveloperTools({...process.env, DEVELOPER_DIR: '/tmp'})
    ).toBe(true)
  }
)

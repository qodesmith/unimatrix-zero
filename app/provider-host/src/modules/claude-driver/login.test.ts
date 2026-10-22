import type {ClaudeCommand} from './login'

import {afterEach, beforeEach, expect, it} from 'vitest'

import {claudeEnvironment} from './environment'
import {FAKE_CODE, FAKE_CODE_PAGE, fakeClaude} from './fake-claude'
import {startLogin} from './login'

const claudeHome = '/nowhere/claude-home'

let claude: Awaited<ReturnType<typeof fakeClaude>>

beforeEach(async () => {
  claude = await fakeClaude()
})

afterEach(async () => {
  await claude.cleanUp()
})

/** Runs the login, typing each code once the page is printed. */
async function login(command: ClaudeCommand, codes: string[]) {
  const urls: string[] = []

  const {promise, resolve} = Promise.withResolvers<{
    code: number | null
    output: string
  }>()

  const running = startLogin(
    command,
    claudeEnvironment(process.env, claudeHome),
    {
      onUrl: url => {
        urls.push(url)

        for (const code of codes) running.enterCode(code)
      },
      onExit: (code, output) => resolve({code, output}),
    }
  )

  return {urls, exit: await promise}
}

it('shows the page that gives a code, and signs in with that code', async () => {
  const {urls, exit} = await login(claude, [FAKE_CODE])

  expect(urls).toEqual([FAKE_CODE_PAGE])
  expect(exit.code).toBe(0)
})

it('ends with what claude said when the code is refused', async () => {
  const {exit} = await login(claude, ['not-it#fake-state'])

  expect(exit).toEqual({
    code: 1,
    output: 'Login failed: Request failed with status code 400',
  })
})

it('can be killed while it waits for a code', async () => {
  const {promise, resolve} = Promise.withResolvers<number | null>()

  const running = startLogin(
    claude,
    claudeEnvironment(process.env, claudeHome),
    {
      onUrl: () => running.kill(),
      onExit: code => resolve(code),
    }
  )

  expect(await promise).not.toBe(0)
})

it('reports a program that does not start', async () => {
  const {exit} = await login({command: '/nowhere/claude', args: []}, [])

  expect(exit.code).toBeNull()
  expect(exit.output).toContain('ENOENT')
})

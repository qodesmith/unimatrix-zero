import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {expect, it} from 'vitest'

import {planOf, readAccount} from './account'

it.each([
  ['Claude Pro', 'Pro'],
  ['Claude Max', 'Max'],
  ['Claude Team', 'Team'],
  ['Claude Enterprise', 'Enterprise'],
  ['Claude Max 20x', 'Max 20x'],
])('reads %s as the %s plan', (subscriptionType, plan) => {
  expect(planOf(subscriptionType)).toBe(plan)
})

it.each([['Claude API'], ['pro'], ['Claude '], ['']])(
  'reads %s as no paid plan',
  subscriptionType => {
    expect(planOf(subscriptionType)).toBeNull()
  }
)

/**
 * Once its input closes, takes longer to exit than the SDK's 2 s, as one
 * finishing a token refresh would. It writes how it ended to `FAKE_ENDED`.
 */
const SESSION = `
import fs from 'node:fs'
const ended = how => fs.writeFileSync(process.env.FAKE_ENDED, how)
process.on('SIGTERM', () => {
  ended('killed')
  process.exit(143)
})
process.stdin.setEncoding('utf8')
let buffer = ''
process.stdin.on('data', chunk => {
  buffer += chunk
  for (let end = buffer.indexOf('\\n'); end >= 0; end = buffer.indexOf('\\n')) {
    const message = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    if (message.type !== 'control_request') continue
    const response = message.request.subtype === 'initialize'
      ? {account: {email: 'sam@example.com', subscriptionType: 'Claude Pro'}}
      : {}
    process.stdout.write(JSON.stringify({
      type: 'control_response',
      response: {subtype: 'success', request_id: message.request_id, response},
    }) + '\\n')
  }
})
process.stdin.on('end', () => {
  setTimeout(() => {
    ended('exited')
    process.exit(0)
  }, 3000)
})
`

it('waits for claude to exit by itself after reading the account', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'uz-fake-session-'))
  // The SDK runs a `.mjs` with the `node` on PATH.
  const program = path.join(folder, 'claude.mjs')
  const endedFile = path.join(folder, 'ended')
  await fs.writeFile(program, SESSION)

  try {
    const account = await readAccount({
      program,
      env: {PATH: process.env.PATH ?? '', FAKE_ENDED: endedFile},
      cwd: folder,
    })

    expect(account).toMatchObject({email: 'sam@example.com'})
    expect(await fs.readFile(endedFile, 'utf8')).toBe('exited')
  } finally {
    await fs.rm(folder, {recursive: true, force: true})
  }
})

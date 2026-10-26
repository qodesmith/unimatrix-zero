import type {ClaudeCommand} from './login'

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export const FAKE_STATE = 'fake-state'

export const FAKE_CODE_PAGE = `https://claude.com/cai/oauth/authorize?code=true&state=${FAKE_STATE}`

export const FAKE_CODE = `the-code#${FAKE_STATE}`

/**
 * `claude auth login` as observed in 2.1.307 with no terminal: a wrong code
 * with a state fails the login; one without a state is refused and it waits.
 * `FAKE_SIGN_IN_ANSWERS=yes` signs in as the local callback does; `no` fails.
 */
const SCRIPT = `
const [, , ...args] = process.argv
if (args.join(' ') !== 'auth login --claudeai') {
  console.error('unexpected arguments: ' + args.join(' '))
  process.exit(2)
}
const url = ${JSON.stringify(FAKE_CODE_PAGE)}
process.stdout.write('Opening browser to sign in\\u2026\\n')
process.stdout.write("If the browser didn't open, visit: \\u001b]8;;" + url + '\\u0007' + url + '\\u001b]8;;\\u0007\\n')
process.stdout.write('Paste code here if prompted > ')
if (process.env.FAKE_SIGN_IN_ANSWERS === 'yes') {
  setTimeout(() => process.exit(0), 10)
}
if (process.env.FAKE_SIGN_IN_ANSWERS === 'no') {
  setTimeout(() => {
    console.error('Login failed: access_denied')
    process.exit(1)
  }, 10)
}
process.stdin.setEncoding('utf8')
let buffer = ''
process.stdin.on('data', chunk => {
  buffer += chunk
  for (let end = buffer.indexOf('\\n'); end >= 0; end = buffer.indexOf('\\n')) {
    const line = buffer.slice(0, end)
    buffer = buffer.slice(end + 1)
    if (line === ${JSON.stringify(FAKE_CODE)}) {
      console.log('Login successful.')
      process.exit(0)
    } else if (line.includes('#')) {
      console.error('Login failed: Request failed with status code 400')
      process.exit(1)
    } else {
      console.error('Invalid code. Please make sure the full code was copied.')
    }
  }
})
`

export async function fakeClaude(): Promise<
  ClaudeCommand & {cleanUp: () => Promise<void>}
> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'uz-fake-claude-'))
  const script = path.join(folder, 'claude.mjs')
  await fs.writeFile(script, SCRIPT)

  return {
    command: process.execPath,
    args: [script],
    cleanUp: async () => fs.rm(folder, {recursive: true, force: true}),
  }
}

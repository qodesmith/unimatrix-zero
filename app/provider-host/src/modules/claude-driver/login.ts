import {spawn} from 'node:child_process'

export interface ClaudeCommand {
  command: string
  args: string[]
}

export interface LoginEvents {
  /** The sign-in page that shows a code to paste, as `claude` printed it. */
  onUrl(url: string): void
  /** `code` is null when `claude` didn't start; `output` is its stderr. */
  onExit(code: number | null, output: string): void
}

export interface Login {
  enterCode(code: string): void
  kill(): void
}

/** The first whole link `claude` prints, without terminal hyperlink escapes. */
// oxlint-disable-next-line no-control-regex -- BEL and ESC end a terminal hyperlink
const LINK = /https:\/\/[^\s\u0007\u001b]+(?=[\s\u0007\u001b])/

/**
 * `claude auth login` opens the browser itself on a local-callback page, and
 * prints a second page that shows a code instead; the code goes to its stdin.
 */
export function startLogin(
  {command, args}: ClaudeCommand,
  env: Record<string, string>,
  events: LoginEvents
): Login {
  const child = spawn(command, [...args, 'auth', 'login', '--claudeai'], {
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let stdout = ''
  let stderr = ''
  let urlSent = false
  let exited = false

  function exit(code: number | null, output: string) {
    if (exited) return

    exited = true
    events.onExit(code, output.trim())
  }

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => {
    if (urlSent) return

    stdout += chunk
    const url = LINK.exec(stdout)?.[0]

    if (url) {
      urlSent = true
      events.onUrl(url)
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  // A write after `claude` exits fails here instead of crashing the host.
  child.stdin.on('error', () => undefined)
  child.on('error', error => exit(null, error.message))
  child.on('close', code => exit(code, stderr))

  return {
    enterCode: code => {
      child.stdin.write(`${code}\n`)
    },
    kill: () => {
      child.kill()
    },
  }
}

export async function signOut(
  {command, args}: ClaudeCommand,
  env: Record<string, string>
) {
  const child = spawn(command, [...args, 'auth', 'logout'], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  })

  await new Promise<void>((resolve, reject) => {
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`claude auth logout exited with ${code}`))
    })
  })
}

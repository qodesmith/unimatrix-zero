import type {AccountInfo, SDKUserMessage} from '@anthropic-ai/claude-agent-sdk'

import {query} from '@anthropic-ai/claude-agent-sdk'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'

/** Far longer than a token refresh; a `claude` still running then is stuck. */
const EXIT_TIMEOUT_MS = 30_000

const PREFIX = 'Claude '

/**
 * `accountInfo()` names the plan the way `claude` shows it: "Claude Pro",
 * "Claude Max", "Claude Team", "Claude Enterprise" or the server's own
 * "Claude <name>" for a paid plan, and "Claude API" for an account with none.
 */
const NO_PLAN = 'Claude API'

/** The plan's name, or null when the account has no paid plan. */
export function planOf(subscriptionType: string): string | null {
  if (!subscriptionType.startsWith(PREFIX) || subscriptionType === NO_PLAN) {
    return null
  }

  return subscriptionType.slice(PREFIX.length).trim() || null
}

interface SessionOptions {
  program: string
  env: Record<string, string>
  cwd: string
}

/**
 * Opens one Claude session without sending it anything and asks it who is
 * signed in. The session ends by closing its input, which lets `claude`
 * finish a token refresh before it exits; this waits until it has.
 */
export async function readAccount({
  program,
  env,
  cwd,
}: SessionOptions): Promise<AccountInfo> {
  const input = Promise.withResolvers<void>()
  let exited: Promise<unknown> = Promise.resolve()

  // oxlint-disable-next-line require-yield -- the session is never sent a Prompt
  async function* noPrompts(): AsyncGenerator<SDKUserMessage> {
    await input.promise
  }

  const session = query({
    prompt: noPrompts(),
    options: {
      pathToClaudeCodeExecutable: program,
      env,
      cwd,
      settingSources: [],
      settings: {autoMemoryEnabled: false},
      // Spawned here only to know when `claude` has exited.
      spawnClaudeCodeProcess: ({
        command,
        args,
        cwd: folder,
        env: vars,
        signal,
      }) => {
        const child = spawn(command, args, {
          cwd: folder,
          env: vars,
          signal,
          stdio: ['pipe', 'pipe', 'ignore'],
          windowsHide: true,
        })

        exited = once(child, 'exit')

        return child
      },
    },
  })

  try {
    return await session.accountInfo()
  } finally {
    // The SDK ends `claude`'s input once the Prompts run out, but closing the
    // session kills `claude` 2 s later, so it closes only once `claude` has
    // exited, or is stuck.
    input.resolve()
    const stuck = new AbortController()
    await Promise.race([
      exited,
      delay(EXIT_TIMEOUT_MS, undefined, {signal: stuck.signal}),
    ]).catch(() => undefined)
    stuck.abort()
    await session.return()
  }
}

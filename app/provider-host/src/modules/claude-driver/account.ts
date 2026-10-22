import type {AccountInfo, SDKUserMessage} from '@anthropic-ai/claude-agent-sdk'

import {query} from '@anthropic-ai/claude-agent-sdk'
import {spawn} from 'node:child_process'
import {once} from 'node:events'

const PREFIX = 'Claude '

/**
 * `accountInfo()` names the plan the way `claude` shows it: "Claude Pro",
 * "Claude Max", "Claude Team", "Claude Enterprise" or the server's own
 * "Claude <name>" for a paid plan, and "Claude API" for an account with none.
 */
const NO_PLAN = 'Claude API'

/** The plan's name, or null when the account has no paid plan. */
export function planOf(subscriptionType: string | undefined): string | null {
  if (!subscriptionType?.startsWith(PREFIX) || subscriptionType === NO_PLAN) {
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
      // The SDK's own spawn stops waiting for the exit after 2 s; this one
      // keeps the process, so closing waits as long as `claude` takes.
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
    input.resolve()
    await session.return()
    await exited.catch(() => undefined)
  }
}

import type {
  AccountInfo,
  ModelInfo,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'

import {query} from '@anthropic-ai/claude-agent-sdk'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {setTimeout as delay} from 'node:timers/promises'

const EXIT_TIMEOUT_MS = 30_000

const PREFIX = 'Claude '

/** `accountInfo()` names a paid plan "Claude <name>", and no plan "Claude API". */
const NO_PLAN = 'Claude API'

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

export interface AccountRead {
  account: AccountInfo
  models: ModelInfo[]
}

export async function readAccount({
  program,
  env,
  cwd,
}: SessionOptions): Promise<AccountRead> {
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
    const {account, models} = await session.initializationResult()

    return {account, models}
  } finally {
    // Closing kills `claude` 2 s later, mid token refresh; wait for its exit.
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

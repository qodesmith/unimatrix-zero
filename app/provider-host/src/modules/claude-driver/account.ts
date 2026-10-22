import type {AccountInfo, SDKUserMessage} from '@anthropic-ai/claude-agent-sdk'

import {query} from '@anthropic-ai/claude-agent-sdk'

/** The plans `claude` itself recognizes; anything else is a free account. */
const PLANS = new Map([
  ['pro', 'Pro'],
  ['max', 'Max'],
  ['team', 'Team'],
  ['enterprise', 'Enterprise'],
])

/** The plan's name, or null when the account has no paid plan. */
export function planOf(subscriptionType: string | undefined): string | null {
  return PLANS.get(subscriptionType ?? '') ?? null
}

interface SessionOptions {
  /** The vendor program. */
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
    },
  })

  try {
    return await session.accountInfo()
  } finally {
    input.resolve()
    await session.return()
  }
}

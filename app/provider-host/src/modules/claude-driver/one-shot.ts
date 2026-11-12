import type {
  Options,
  SDKMessage,
  SDKResultError,
  SDKResultSuccess,
} from '@anthropic-ai/claude-agent-sdk'
import type {OneShotRequest} from '@uz/contract/host'

import {setTimeout as delay} from 'node:timers/promises'

import {claudeEnvironment} from './environment'
import {CLOSE_TIMEOUT_MS} from './session'

export type OneShotMessage =
  | {type: Exclude<SDKMessage['type'], 'result'>}
  | Pick<SDKResultSuccess, 'type' | 'subtype' | 'is_error' | 'result'>
  | Pick<SDKResultError, 'type' | 'subtype' | 'errors'>

export type OneShotQuery = (params: {
  prompt: string
  options: Options
}) => AsyncGenerator<OneShotMessage, void> & {close(): void}

type Running = ReturnType<OneShotQuery>

/** Leaves `running` open: leaving a `for await` early would close it. */
async function resultOf(running: Running) {
  for (;;) {
    const step = await running.next()

    if (step.done) throw new Error('Claude ended without an answer.')

    if (step.value.type === 'result') return step.value
  }
}

/** Waits for `claude` to exit by itself, as it may be refreshing its token. */
async function closeOnExit(running: Running) {
  const stuck = new AbortController()

  const exited = await Promise.race([
    (async () => {
      for await (const _ of running);
    })().then(
      () => true,
      () => true
    ),
    delay(CLOSE_TIMEOUT_MS, false, {signal: stuck.signal}),
  ])

  stuck.abort()

  if (!exited) running.close()
}

/** A string prompt ends `claude`'s input after its one result. */
export async function runClaudeOneShot(
  deps: {query: OneShotQuery; env: NodeJS.ProcessEnv},
  {model, prompt, vendorProgram: {program, configDir}}: OneShotRequest,
  signal: AbortSignal
): Promise<string> {
  if (!program) throw new Error('The manifest names no Claude program.')

  const running = deps.query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: program.path,
      env: claudeEnvironment(deps.env, configDir),
      cwd: configDir,
      settingSources: [],
      settings: {autoMemoryEnabled: false},
      tools: [],
      strictMcpConfig: true,
      mcpServers: {},
      persistSession: false,
      maxTurns: 1,
      // Else an `@path` quoted from a Prompt or Reply is read in as a file.
      verbatimPrompts: true,
      model,
    },
  })

  function close() {
    running.close()
  }

  signal.addEventListener('abort', close)

  try {
    const result = await resultOf(running)

    if (result.subtype === 'success' && !result.is_error) return result.result

    throw new Error(
      result.subtype === 'success' ? result.result : result.errors.join(' ')
    )
  } finally {
    signal.removeEventListener('abort', close)
    await closeOnExit(running)
  }
}

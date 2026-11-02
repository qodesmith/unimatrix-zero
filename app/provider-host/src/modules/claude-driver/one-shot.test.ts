import type {OneShotMessage, OneShotQuery} from './one-shot'

import {expect, it} from 'vitest'

import {runClaudeOneShot} from './one-shot'

const request = {
  model: 'haiku',
  prompt: 'Name this conversation.',
  vendorProgram: {
    program: {
      path: '/programs/claude',
      build: {url: 'https://example.com/claude', sha256: '', size: 0},
    },
    configDir: '/claude',
  },
}

/**
 * `exited` holds the fake `claude` open after its last message; `close` ends
 * it, as the SDK's does.
 */
function fakeClaude(
  messages: OneShotMessage[],
  exited: Promise<void> = Promise.resolve()
) {
  const asked: Parameters<OneShotQuery>[0][] = []
  const closed = Promise.withResolvers<void>()
  let closes = 0

  async function* run() {
    yield* messages
    await Promise.race([exited, closed.promise])
  }

  function query(params: Parameters<OneShotQuery>[0]) {
    asked.push(params)

    return Object.assign(run(), {
      close() {
        closes += 1
        closed.resolve()
      },
    })
  }

  return {query, asked, closes: () => closes}
}

const notCanceled = new AbortController().signal

const answered: OneShotMessage[] = [
  {type: 'system'},
  {type: 'assistant'},
  {type: 'result', subtype: 'success', is_error: false, result: 'Otters'},
]

it('asks claude once, with no tools, settings or saved session, and answers with the result', async () => {
  const claude = fakeClaude(answered)

  const text = await runClaudeOneShot(
    {query: claude.query, env: {PATH: '/bin'}},
    request,
    notCanceled
  )

  expect(text).toBe('Otters')
  expect(claude.asked).toEqual([
    {
      prompt: 'Name this conversation.',
      options: {
        pathToClaudeCodeExecutable: '/programs/claude',
        env: expect.objectContaining({
          PATH: '/bin',
          CLAUDE_CONFIG_DIR: '/claude',
        }),
        cwd: '/claude',
        settingSources: [],
        settings: {autoMemoryEnabled: false},
        tools: [],
        strictMcpConfig: true,
        mcpServers: {},
        persistSession: false,
        maxTurns: 1,
        model: 'haiku',
      },
    },
  ])
})

it.each<[string, OneShotMessage, string]>([
  [
    'an error result',
    {type: 'result', subtype: 'error_max_turns', errors: ['Too', 'many.']},
    'Too many.',
  ],
  [
    'a success result marked as an error',
    {type: 'result', subtype: 'success', is_error: true, result: 'Limit hit.'},
    'Limit hit.',
  ],
])('rejects with the message of %s', async (_, result, message) => {
  const claude = fakeClaude([{type: 'system'}, result])

  await expect(
    runClaudeOneShot({query: claude.query, env: {}}, request, notCanceled)
  ).rejects.toThrow(message)
})

it('rejects when claude ends without a result', async () => {
  const claude = fakeClaude([{type: 'system'}, {type: 'assistant'}])

  await expect(
    runClaudeOneShot({query: claude.query, env: {}}, request, notCanceled)
  ).rejects.toThrow('Claude ended without an answer.')
})

it('answers only once claude has exited by itself', async () => {
  const exit = Promise.withResolvers<void>()
  const claude = fakeClaude(answered, exit.promise)

  const text = runClaudeOneShot(
    {query: claude.query, env: {}},
    request,
    notCanceled
  )

  await expect(
    Promise.race([
      text,
      new Promise(resolve => {
        setTimeout(resolve, 0, 'exiting')
      }),
    ])
  ).resolves.toBe('exiting')

  exit.resolve()

  await expect(text).resolves.toBe('Otters')
})

it('rejects without starting claude when the manifest names no program', async () => {
  const claude = fakeClaude(answered)

  await expect(
    runClaudeOneShot(
      {query: claude.query, env: {}},
      {...request, vendorProgram: {program: null, configDir: '/claude'}},
      notCanceled
    )
  ).rejects.toThrow('The manifest names no Claude program.')
  expect(claude.asked).toEqual([])
})

it('ends a claude that hangs once main cancels the one-shot', async () => {
  const hung = Promise.withResolvers<void>().promise
  const claude = fakeClaude([{type: 'system'}], hung)
  const cancel = new AbortController()

  const text = runClaudeOneShot(
    {query: claude.query, env: {}},
    request,
    cancel.signal
  )

  cancel.abort()

  await expect(text).rejects.toThrow('Claude ended without an answer.')
  expect(claude.closes()).toBe(1)
})

it('lets claude exit by itself when the cancel comes after its answer', async () => {
  const exit = Promise.withResolvers<void>()
  const claude = fakeClaude(answered, exit.promise)
  const cancel = new AbortController()

  const text = runClaudeOneShot(
    {query: claude.query, env: {}},
    request,
    cancel.signal
  )

  await new Promise(resolve => {
    setTimeout(resolve, 0)
  })
  cancel.abort()
  exit.resolve()

  await expect(text).resolves.toBe('Otters')
  expect(claude.closes()).toBe(0)
})

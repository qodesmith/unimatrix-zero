import {expect, it} from 'vitest'

import {failureOf} from './main'

it.each([
  ['fetch failed', 'connection-lost'],
  ['Error: connect ECONNREFUSED 127.0.0.1:443', 'connection-lost'],
  ['stream disconnected before completion', 'connection-lost'],
  ['429 Too Many Requests', 'limit-reached'],
  ['You’ve hit your limit', 'limit-reached'],
  ['ENOSPC: no space left on device, write', 'disk-full'],
  ['Prompt is too long', 'provider-error'],
  [
    "The 'gpt-5.9' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
    'needs-app-update',
  ],
  [
    "The 'claude-opus-9' model requires a newer version of Claude Code.",
    'needs-app-update',
  ],
  ['This feature requires a newer version of macOS.', 'provider-error'],
])('names the failure in %j as %s', (message, code) => {
  expect(failureOf(message)).toEqual({code, message})
})

it('keeps when a limit lifts, when the Provider said', () => {
  expect(
    failureOf('Usage limit reached. Resets at 2026-10-24T15:00:00Z.')
  ).toEqual({
    code: 'limit-reached',
    message: 'Usage limit reached. Resets at 2026-10-24T15:00:00Z.',
    resetsAt: '2026-10-24T15:00:00.000Z',
  })
  expect(failureOf('Rate limit reached, resets 1793970000')).toMatchObject({
    resetsAt: '2026-11-06T13:00:00.000Z',
  })
  expect(failureOf('Rate limit reached. Resets in a while.')).toEqual({
    code: 'limit-reached',
    message: 'Rate limit reached. Resets in a while.',
  })
})

it('takes when a limit lifts from the Provider over the message', () => {
  const message = 'You’ve hit your limit · resets 2026-10-24T15:00:00Z'

  expect(failureOf(message, {resetsAt: 1793970000})).toEqual({
    code: 'limit-reached',
    message,
    resetsAt: '2026-11-06T13:00:00.000Z',
  })
  expect(failureOf('fetch failed', {resetsAt: 1793970000})).toEqual({
    code: 'connection-lost',
    message: 'fetch failed',
  })
})

it('names a Prompt over Codex’s text cap as too long, with both counts from the refusal', () => {
  const message = 'Input exceeds the maximum length of 1048576 characters.'

  expect(
    failureOf(message, {
      refusal: {
        input_error_code: 'input_too_large',
        max_chars: 1_048_576,
        actual_chars: 1_240_000,
      },
    })
  ).toEqual({
    code: 'too-long',
    message,
    promptChars: 1_240_000,
    maxPromptChars: 1_048_576,
  })
  expect(
    failureOf('Invalid request', {refusal: {input_error_code: 'empty_input'}})
  ).toEqual({code: 'provider-error', message: 'Invalid request'})
})

it.each([
  [
    'Codex reports the Context window exceeded',
    {codexErrorInfo: 'contextWindowExceeded'},
  ],
  ['the Claude API refuses the Prompt', {terminalReason: 'prompt_too_long'}],
  [
    '`claude` refuses before calling the API',
    {terminalReason: 'blocking_limit'},
  ],
])(
  'names a Reply as too long when %s, however the message reads',
  (_, signals) => {
    expect(failureOf('Reworded by the vendor', signals)).toEqual({
      code: 'too-long',
      message: 'Reworded by the vendor',
    })
  }
)

it.each([
  ['another Codex error', {codexErrorInfo: 'serverOverloaded'}],
  [
    'a Codex error with details',
    {codexErrorInfo: {httpConnectionFailed: {httpStatusCode: 500}}},
  ],
  ['another way a Claude turn ends', {terminalReason: 'model_error'}],
])('leaves %s a provider error', (_, signals) => {
  expect(failureOf('Prompt is too long', signals)).toEqual({
    code: 'provider-error',
    message: 'Prompt is too long',
  })
})

it('keeps a usage limit a reached limit when `claude` blocks the turn for it', () => {
  expect(
    failureOf('You’ve hit your limit · resets 2026-10-24T15:00:00Z', {
      terminalReason: 'blocking_limit',
    })
  ).toEqual({
    code: 'limit-reached',
    message: 'You’ve hit your limit · resets 2026-10-24T15:00:00Z',
    resetsAt: '2026-10-24T15:00:00.000Z',
  })
  expect(
    failureOf('Prompt is too long', {
      terminalReason: 'blocking_limit',
      resetsAt: 1793970000,
    })
  ).toEqual({
    code: 'limit-reached',
    message: 'Prompt is too long',
    resetsAt: '2026-11-06T13:00:00.000Z',
  })
})

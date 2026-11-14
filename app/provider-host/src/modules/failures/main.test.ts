import type {ClaudeSignals, CodexSignals} from './main'

import {expect, it} from 'vitest'

import {claudeFailureOf, codexFailureOf, failureOf} from './main'

const MESSAGE = 'Reworded by the vendor'

const CLAUDE_LOST: ClaudeSignals = {
  terminalReason: 'api_error',
  apiErrorStatus: null,
  retryStatus: null,
}

const CODEX_LOST_RETRY = {responseStreamDisconnected: {httpStatusCode: null}}

it.each([
  ['ENOSPC: no space left on device, write', 'disk-full'],
  [
    "The 'gpt-5.9' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
    'needs-app-update',
  ],
  [
    "The 'claude-opus-9' model requires a newer version of Claude Code.",
    'needs-app-update',
  ],
  ['This feature requires a newer version of macOS.', 'provider-error'],
  ['fetch failed', 'provider-error'],
  ['Error: connect ECONNREFUSED 127.0.0.1:443', 'provider-error'],
  ['Usage limit reached. Resets at 2026-10-24T15:00:00Z.', 'provider-error'],
  ['429 Too Many Requests', 'provider-error'],
])('names a failure with no typed fields, %j, as %s', (message, code) => {
  expect(failureOf(message)).toEqual({code, message})
})

it('names a Prompt over Codex’s text cap as too long, with the refusal’s counts when it sends both', () => {
  const message = 'Input exceeds the maximum length of 1048576 characters.'

  expect(
    failureOf(message, {
      input_error_code: 'input_too_large',
      max_chars: 1_048_576,
      actual_chars: 1_240_000,
    })
  ).toEqual({
    code: 'too-long',
    message,
    promptChars: 1_240_000,
    maxPromptChars: 1_048_576,
  })
  expect(failureOf(MESSAGE, {input_error_code: 'input_too_large'})).toEqual({
    code: 'too-long',
    message: MESSAGE,
  })
})

it('leaves a request Codex refused for another reason a provider error', () => {
  expect(
    failureOf('Invalid request', {input_error_code: 'empty_input'})
  ).toEqual({code: 'provider-error', message: 'Invalid request'})
})

it.each<[string, ClaudeSignals]>([
  ['a lost connection that ran out of retries', CLAUDE_LOST],
  [
    'a Compaction that failed and left the turn blocked',
    {
      terminalReason: 'blocking_limit',
      apiErrorStatus: null,
      compactionFailed: true,
    },
  ],
  [
    'a Compaction that failed on a 500, which sends the same fields',
    {
      terminalReason: 'blocking_limit',
      apiErrorStatus: null,
      retryStatus: 500,
      compactionFailed: true,
    },
  ],
])('names %s on Claude as connection-lost', (_, signals) => {
  expect(claudeFailureOf(MESSAGE, signals)).toEqual({
    code: 'connection-lost',
    message: MESSAGE,
  })
})

it.each<[string, ClaudeSignals]>([
  [
    'a rejected limit',
    {
      terminalReason: 'api_error',
      apiErrorStatus: 429,
      assistantError: 'rate_limit',
      rejectedLimit: {resetsAt: 1793970000},
    },
  ],
  [
    'a rejected limit that failed the Compaction of a blocked turn',
    {
      terminalReason: 'blocking_limit',
      apiErrorStatus: null,
      compactionFailed: true,
      rejectedLimit: {resetsAt: 1793970000},
    },
  ],
])('names %s on Claude as limit-reached, with when it lifts', (_, signals) => {
  expect(claudeFailureOf(MESSAGE, signals)).toEqual({
    code: 'limit-reached',
    message: MESSAGE,
    resetsAt: '2026-11-06T13:00:00.000Z',
  })
})

it.each<[string, ClaudeSignals]>([
  [
    'a rejected limit with no reset time',
    {terminalReason: 'api_error', apiErrorStatus: 429, rejectedLimit: {}},
  ],
  [
    'a credit balance too low',
    {
      terminalReason: 'api_error',
      apiErrorStatus: 400,
      assistantError: 'billing_error',
    },
  ],
])('names %s on Claude as limit-reached, with no reset time', (_, signals) => {
  expect(claudeFailureOf(MESSAGE, signals)).toEqual({
    code: 'limit-reached',
    message: MESSAGE,
  })
})

it.each<[string, ClaudeSignals, string]>([
  [
    'a 500 that ran out of retries',
    {terminalReason: 'api_error', apiErrorStatus: 500, retryStatus: 500},
    'provider-error',
  ],
  [
    'a 529 that ran out of time',
    {terminalReason: 'api_error', apiErrorStatus: 529, retryStatus: 529},
    'provider-error',
  ],
  [
    'a failure with no status and no retry before it',
    {terminalReason: 'api_error', apiErrorStatus: null},
    'provider-error',
  ],
  [
    'a 500 after retries with no status',
    {terminalReason: 'api_error', apiErrorStatus: 500, retryStatus: null},
    'provider-error',
  ],
  [
    'a 402',
    {
      terminalReason: 'api_error',
      apiErrorStatus: 402,
      assistantError: 'unknown',
    },
    'provider-error',
  ],
  [
    'a rate_limit error with no rejected limit',
    {
      terminalReason: 'api_error',
      apiErrorStatus: 429,
      assistantError: 'rate_limit',
    },
    'provider-error',
  ],
  [
    'another way a turn ends',
    {terminalReason: 'model_error'},
    'provider-error',
  ],
  [
    'a turn blocked with no failed Compaction',
    {terminalReason: 'blocking_limit', apiErrorStatus: null},
    'too-long',
  ],
  [
    'a Prompt the API refused as too long',
    {terminalReason: 'prompt_too_long'},
    'too-long',
  ],
])('names %s on Claude as %s', (_, signals, code) => {
  expect(claudeFailureOf(MESSAGE, signals)).toEqual({code, message: MESSAGE})
})

it('reads neither a lost connection, a limit nor a reset time from Claude’s wording', () => {
  for (const message of [
    'API Error: Connection dropped (ECONNRESET)',
    'You’ve hit your limit · resets 2026-10-24T15:00:00Z',
  ]) {
    expect(claudeFailureOf(message, {terminalReason: 'api_error'})).toEqual({
      code: 'provider-error',
      message,
    })
  }
})

it('still names a needed app update and a full disk on Claude by their wording', () => {
  const message =
    "The 'claude-opus-9' model requires a newer version of Claude Code."

  expect(claudeFailureOf(message, {terminalReason: 'api_error'})).toEqual({
    code: 'needs-app-update',
    message,
  })
  expect(claudeFailureOf('ENOSPC: no space left', {})).toEqual({
    code: 'disk-full',
    message: 'ENOSPC: no space left',
  })
})

it.each<[string, CodexSignals]>([
  [
    'a dropped stream that ran out of retries',
    {codexErrorInfo: 'other', retryErrorInfo: CODEX_LOST_RETRY},
  ],
  [
    'a failed connect after retries with no status',
    {
      codexErrorInfo: {httpConnectionFailed: {httpStatusCode: null}},
      retryErrorInfo: CODEX_LOST_RETRY,
    },
  ],
])('names %s on Codex as connection-lost', (_, signals) => {
  expect(codexFailureOf(MESSAGE, {...signals, resetsAt: 1793970000})).toEqual({
    code: 'connection-lost',
    message: MESSAGE,
  })
})

it.each<[string, unknown]>([
  ['a usage limit', 'usageLimitExceeded'],
  ['a rate limit', 'rateLimitExceeded'],
  [
    'a 429 Codex stopped retrying',
    {responseTooManyFailedAttempts: {httpStatusCode: 429}},
  ],
])('names %s on Codex as limit-reached', (_, codexErrorInfo) => {
  const signals = {codexErrorInfo, retryErrorInfo: CODEX_LOST_RETRY}

  expect(codexFailureOf(MESSAGE, signals)).toEqual({
    code: 'limit-reached',
    message: MESSAGE,
  })
  expect(codexFailureOf(MESSAGE, {...signals, resetsAt: 1793970000})).toEqual({
    code: 'limit-reached',
    message: MESSAGE,
    resetsAt: '2026-11-06T13:00:00.000Z',
  })
})

it.each<[string, CodexSignals, string]>([
  [
    'other with no retry before it',
    {codexErrorInfo: 'other'},
    'provider-error',
  ],
  [
    'other after a retry with a status',
    {
      codexErrorInfo: 'other',
      retryErrorInfo: {responseStreamDisconnected: {httpStatusCode: 429}},
    },
    'provider-error',
  ],
  [
    'a failed connect with no retry before it',
    {codexErrorInfo: {httpConnectionFailed: {httpStatusCode: null}}},
    'provider-error',
  ],
  [
    'a gateway status after retries with none',
    {
      codexErrorInfo: {httpConnectionFailed: {httpStatusCode: 502}},
      retryErrorInfo: CODEX_LOST_RETRY,
    },
    'provider-error',
  ],
  [
    'a server error after retries with no status',
    {codexErrorInfo: 'internalServerError', retryErrorInfo: CODEX_LOST_RETRY},
    'provider-error',
  ],
  [
    'another status Codex stopped retrying',
    {codexErrorInfo: {responseTooManyFailedAttempts: {httpStatusCode: 500}}},
    'provider-error',
  ],
  [
    'a session budget',
    {codexErrorInfo: 'sessionBudgetExceeded'},
    'provider-error',
  ],
  [
    'the Context window exceeded',
    {codexErrorInfo: 'contextWindowExceeded'},
    'too-long',
  ],
])('names %s on Codex as %s', (_, signals, code) => {
  expect(codexFailureOf(MESSAGE, signals)).toEqual({code, message: MESSAGE})
})

it('reads neither a lost connection nor a limit from Codex’s wording', () => {
  for (const message of [
    'stream disconnected before completion',
    'You’ve hit your usage limit. Try again at 11:52 PM.',
  ]) {
    expect(codexFailureOf(message, {codexErrorInfo: 'other'})).toEqual({
      code: 'provider-error',
      message,
    })
  }
})

it('still names a needed app update on Codex by its wording', () => {
  const message =
    "The 'gpt-5.9' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."

  expect(codexFailureOf(message, {codexErrorInfo: 'badRequest'})).toEqual({
    code: 'needs-app-update',
    message,
  })
})

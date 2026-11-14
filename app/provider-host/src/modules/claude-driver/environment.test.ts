import {expect, it} from 'vitest'

import {claudeEnvironment, claudeReplyEnvironment} from './environment'

it('strips every variable that could outrank the subscription', () => {
  const env = claudeEnvironment(
    {
      PATH: '/usr/bin',
      HOME: '/Users/sam',
      ANTHROPIC_API_KEY: 'sk-ant-api',
      ANTHROPIC_AUTH_TOKEN: 'token',
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth',
      CLAUDE_CONFIG_DIR: '/Users/sam/.claude',
      OPENAI_API_KEY: 'sk-openai',
      CODEX_HOME: '/Users/sam/.codex',
      claude_code_use_bedrock: '1',
      UNSET: undefined,
    },
    '/data/providers/claude'
  )

  expect(env).toStrictEqual({
    PATH: '/usr/bin',
    HOME: '/Users/sam',
    CLAUDE_CONFIG_DIR: '/data/providers/claude',
    CLAUDE_SECURESTORAGE_CONFIG_DIR: '/data/providers/claude',
    DISABLE_UPDATES: '1',
  })
})

it('lets a Reply wait out a lost connection, but not a usage limit', () => {
  expect(claudeReplyEnvironment({PATH: '/usr/bin'}, '/claude')).toStrictEqual({
    ...claudeEnvironment({PATH: '/usr/bin'}, '/claude'),
    CLAUDE_CODE_RETRY_WATCHDOG: '1',
    CLAUDE_CODE_RETRY_WATCHDOG_MAX_USAGE_LIMIT_WAIT_MS: '1',
  })
})

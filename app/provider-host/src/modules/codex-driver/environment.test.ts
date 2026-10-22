import {expect, it} from 'vitest'

import {CODEX_ARGS, codexEnvironment} from './environment'

it('strips every variable that could outrank the subscription', () => {
  const env = codexEnvironment(
    {
      PATH: '/usr/bin',
      HOME: '/Users/sam',
      OPENAI_API_KEY: 'sk-openai',
      OPENAI_BASE_URL: 'https://proxy.example.com',
      CODEX_HOME: '/Users/sam/.codex',
      codex_api_key: 'key',
      ANTHROPIC_API_KEY: 'sk-ant-api',
      UNSET: undefined,
    },
    '/data/providers/chatgpt'
  )

  expect(env).toEqual({
    PATH: '/usr/bin',
    HOME: '/Users/sam',
    CODEX_HOME: '/data/providers/chatgpt',
  })
})

it('turns the self-updater off', () => {
  expect(CODEX_ARGS.join(' ')).toContain('-c check_for_update_on_startup=false')
})

import type {ProviderId, SignInFailure} from '@uz/contract/providers'

import {PROVIDER_NAMES} from '@uz/contract/providers'

export const ABOUT: Record<
  ProviderId,
  {
    plans: string
    company: string
    mark: string
    program: string
    refused: string
  }
> = {
  claude: {
    plans: 'Pro or Max',
    company: 'Anthropic',
    mark: '✳',
    program: 'Claude Code',
    refused: 'Unimatrix Zero needs Claude Pro or Max.',
  },
  chatgpt: {
    plans: 'Any plan',
    company: 'OpenAI',
    mark: '◎',
    program: 'Codex',
    refused:
      'Codex isn’t turned on for this ChatGPT workspace. Ask its admin, or use a different account.',
  },
}

const FAILURE_LINES: Record<
  SignInFailure['reason'],
  (provider: ProviderId, failure: SignInFailure) => string
> = {
  'download-failed': provider =>
    `Couldn’t get ${PROVIDER_NAMES[provider]} ready. Check your internet connection and try again.`,
  'no-answer': provider =>
    `Sign-in didn’t finish on ${PROVIDER_NAMES[provider]}’s page. Try again.`,
  'plan-refused': provider => ABOUT[provider].refused,
  failed: (_provider, failure) => failure.message,
}

export function failureLine(provider: ProviderId, failure: SignInFailure) {
  return FAILURE_LINES[failure.reason](provider, failure)
}

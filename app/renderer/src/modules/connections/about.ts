import type {ProviderId, SignInFailure} from '@uz/contract/providers'

import {PROVIDER_NAMES} from '@uz/contract/providers'

/** How each Provider's card names its plans, its company and its program. */
export const ABOUT: Record<
  ProviderId,
  {
    /** Which of the Provider's plans can connect. */
    plans: string
    company: string
    mark: string
    program: string
    /** Why an account the vendor program refuses can't connect. */
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

/** Why connecting failed, in plain words for the card. */
export function failureLine(provider: ProviderId, failure: SignInFailure) {
  return FAILURE_LINES[failure.reason](provider, failure)
}

import {SYSTEM_PROMPT_MAX_LENGTH} from '@uz/contract/system-prompts'

import {isTooLong} from '../too-long'

/**
 * In place of a textarea `maxLength`, which would cut a long paste short
 * without a word.
 */
export function TooLong({text}: {text: string}) {
  if (!isTooLong(text)) return null

  const over = text.length - SYSTEM_PROMPT_MAX_LENGTH

  return (
    <p role="status" className="text-sm text-destructive">
      A System prompt holds up to{' '}
      {SYSTEM_PROMPT_MAX_LENGTH.toLocaleString('en-US')} characters. This one is{' '}
      {over.toLocaleString('en-US')} over.
    </p>
  )
}

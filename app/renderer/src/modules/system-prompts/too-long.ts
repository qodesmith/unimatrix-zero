import {SYSTEM_PROMPT_MAX_LENGTH} from '@uz/contract/system-prompts'

export function isTooLong(text: string) {
  return text.length > SYSTEM_PROMPT_MAX_LENGTH
}

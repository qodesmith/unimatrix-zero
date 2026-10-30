import {DEFAULT_SETTINGS, TEXT_SIZE} from '@uz/contract/settings'

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>

/** Null when the press is not a text size key. */
export function textSizeFor(press: KeyPress, current: number): number | null {
  if (!(press.metaKey || press.ctrlKey) || press.altKey) return null

  switch (press.key) {
    case '=':
    case '+':
      return Math.min(current + TEXT_SIZE.step, TEXT_SIZE.max)

    case '-':
    case '_':
      return Math.max(current - TEXT_SIZE.step, TEXT_SIZE.min)

    case '0':
      return DEFAULT_SETTINGS.textSize

    default:
      return null
  }
}

import {DEFAULT_SETTINGS, FONT_SIZE} from '@uz/contract/settings'

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>

/** Null when the press is not a font size key. */
export function fontSizeFor(press: KeyPress, current: number): number | null {
  if (!(press.metaKey || press.ctrlKey) || press.altKey) return null

  switch (press.key) {
    case '=':
    case '+':
      return Math.min(current + FONT_SIZE.step, FONT_SIZE.max)

    case '-':
    case '_':
      return Math.max(current - FONT_SIZE.step, FONT_SIZE.min)

    case '0':
      return DEFAULT_SETTINGS.fontSize

    default:
      return null
  }
}

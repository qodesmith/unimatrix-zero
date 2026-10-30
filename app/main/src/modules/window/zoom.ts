import type {Input} from 'electron'

/** Chrome's steps, so ⌘+ and ⌘− feel the same as in a browser. */
const FACTORS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2]

type Keys = Pick<Input, 'type' | 'key' | 'meta' | 'control' | 'alt'>

/** Null when the press is not a zoom key. Ctrl stands in for ⌘ off macOS. */
export function zoomFor(
  input: Keys,
  current: number,
  platform: NodeJS.Platform
): number | null {
  const mod = platform === 'darwin' ? input.meta : input.control

  if (input.type !== 'keyDown' || !mod || input.alt) return null

  switch (input.key) {
    case '=':
    case '+':
      return FACTORS.find(factor => factor > current + 0.001) ?? current

    case '-':
    case '_':
      return FACTORS.findLast(factor => factor < current - 0.001) ?? current

    case '0':
      return 1

    default:
      return null
  }
}

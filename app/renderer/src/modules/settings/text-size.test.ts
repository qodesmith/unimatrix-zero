import {expect, it} from 'vitest'

import {textSizeFor} from './text-size'

function press(
  key: string,
  held: {metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean} = {}
) {
  return {
    key,
    metaKey: held.metaKey ?? true,
    ctrlKey: held.ctrlKey ?? false,
    altKey: held.altKey ?? false,
  }
}

it('steps up a pixel on ⌘+ and ⌘=, and down on ⌘− and ⌘_', () => {
  expect(textSizeFor(press('='), 16)).toBe(17)
  expect(textSizeFor(press('+'), 17)).toBe(18)
  expect(textSizeFor(press('-'), 18)).toBe(17)
  expect(textSizeFor(press('_'), 17)).toBe(16)
})

it('stays within 12px and 24px', () => {
  expect(textSizeFor(press('='), 24)).toBe(24)
  expect(textSizeFor(press('-'), 12)).toBe(12)
})

it('goes back to 16px on ⌘0', () => {
  expect(textSizeFor(press('0'), 21)).toBe(16)
})

it('takes Ctrl as well as ⌘', () => {
  expect(textSizeFor(press('=', {metaKey: false, ctrlKey: true}), 16)).toBe(17)
})

it('leaves every other key to the page', () => {
  expect(textSizeFor(press('a'), 16)).toBeNull()
  expect(textSizeFor(press('=', {metaKey: false}), 16)).toBeNull()
  expect(textSizeFor(press('=', {altKey: true}), 16)).toBeNull()
})

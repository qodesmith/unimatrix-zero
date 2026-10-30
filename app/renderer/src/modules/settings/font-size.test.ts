import {expect, it} from 'vitest'

import {fontSizeFor} from './font-size'

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

it('steps up 2px on ⌘+ and ⌘=, and down on ⌘− and ⌘_', () => {
  expect(fontSizeFor(press('='), 16)).toBe(18)
  expect(fontSizeFor(press('+'), 18)).toBe(20)
  expect(fontSizeFor(press('-'), 20)).toBe(18)
  expect(fontSizeFor(press('_'), 18)).toBe(16)
})

it('stays within 12px and 24px', () => {
  expect(fontSizeFor(press('='), 24)).toBe(24)
  expect(fontSizeFor(press('-'), 12)).toBe(12)
})

it('goes back to 16px on ⌘0', () => {
  expect(fontSizeFor(press('0'), 22)).toBe(16)
})

it('takes Ctrl as well as ⌘', () => {
  expect(fontSizeFor(press('=', {metaKey: false, ctrlKey: true}), 16)).toBe(18)
})

it('leaves every other key to the page', () => {
  expect(fontSizeFor(press('a'), 16)).toBeNull()
  expect(fontSizeFor(press('=', {metaKey: false}), 16)).toBeNull()
  expect(fontSizeFor(press('=', {altKey: true}), 16)).toBeNull()
})

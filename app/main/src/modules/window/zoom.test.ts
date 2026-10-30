import {expect, it} from 'vitest'

import {withinSteps, zoomFor} from './zoom'

function press(key: string, held: {meta?: boolean; control?: boolean} = {}) {
  return {
    type: 'keyDown',
    key,
    meta: held.meta ?? true,
    control: held.control ?? false,
    alt: false,
  }
}

it('steps up on ⌘+ and ⌘=, and down on ⌘− and ⌘_', () => {
  expect(zoomFor(press('='), 1, 'darwin')).toBe(1.1)
  expect(zoomFor(press('+'), 1.1, 'darwin')).toBe(1.25)
  expect(zoomFor(press('-'), 1.25, 'darwin')).toBe(1.1)
  expect(zoomFor(press('-'), 1, 'darwin')).toBe(0.9)
  expect(zoomFor(press('_'), 0.9, 'darwin')).toBe(0.8)
})

it('goes back to 100% on ⌘0', () => {
  expect(zoomFor(press('0'), 1.75, 'darwin')).toBe(1)
})

it('stays at the largest and the smallest step', () => {
  expect(zoomFor(press('='), 2, 'darwin')).toBe(2)
  expect(zoomFor(press('-'), 0.5, 'darwin')).toBe(0.5)
})

it('steps from a zoom between two steps to the next one along', () => {
  expect(zoomFor(press('='), 1.2, 'darwin')).toBe(1.25)
  expect(zoomFor(press('-'), 1.2, 'darwin')).toBe(1.1)
})

it('takes Ctrl rather than ⌘ off macOS', () => {
  expect(zoomFor(press('=', {meta: false, control: true}), 1, 'win32')).toBe(
    1.1
  )
  expect(zoomFor(press('='), 1, 'win32')).toBeNull()
  expect(
    zoomFor(press('=', {meta: false, control: true}), 1, 'darwin')
  ).toBeNull()
})

it('leaves every other key to the page', () => {
  expect(zoomFor(press('a'), 1, 'darwin')).toBeNull()
  expect(zoomFor(press('=', {meta: false}), 1, 'darwin')).toBeNull()
  expect(zoomFor({...press('='), type: 'keyUp'}, 1, 'darwin')).toBeNull()
  expect(zoomFor({...press('='), alt: true}, 1, 'darwin')).toBeNull()
})

it('keeps a zoom set outside the steps within the largest and the smallest', () => {
  expect(withinSteps(2.49)).toBe(2)
  expect(withinSteps(0.33)).toBe(0.5)
  expect(withinSteps(1.2)).toBe(1.2)
})

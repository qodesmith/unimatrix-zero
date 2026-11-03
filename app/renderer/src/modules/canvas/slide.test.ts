import {expect, it} from 'vitest'

import {durationMs, slideMs} from './slide'

it('reads a CSS time in milliseconds or seconds as milliseconds', () => {
  expect(durationMs('400ms ')).toBe(400)
  expect(durationMs('0.4s')).toBe(400)
  expect(durationMs('0.25s, 0.25s')).toBe(250)
})

it('reads no time at all as 0', () => {
  expect(durationMs('')).toBe(0)
})

it('reads the slide motion’s length from `--transition-duration-slide`', () => {
  document.documentElement.style.setProperty(
    '--transition-duration-slide',
    '250ms'
  )

  try {
    expect(slideMs()).toBe(250)
  } finally {
    document.documentElement.style.removeProperty('--transition-duration-slide')
  }
})

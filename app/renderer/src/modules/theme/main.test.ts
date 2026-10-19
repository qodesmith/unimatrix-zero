import {expect, it} from 'vitest'

import {applyThemeSet, hearth} from './main'

it('puts every Hearth token on :root as a CSS variable', () => {
  const root = document.createElement('div')
  applyThemeSet(hearth.dark!, 'dark', root)
  expect(root.style.getPropertyValue('--primary')).toBe('#e07a52')
  expect(root.style.getPropertyValue('--radius')).toBe('0.75rem')
  expect(root.style.getPropertyValue('--font')).toContain('Figtree')
  expect(root.dataset.mode).toBe('dark')
})

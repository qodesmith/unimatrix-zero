import type {ResolvedThemeMode} from '@uz/contract/theme'

import {fromPartial} from '@total-typescript/shoehorn'
import {expect, it} from 'vitest'

import {hearth} from './hearth'
import {followColorScheme} from './main'

function fakeWindow(prefersDark: boolean) {
  const root = document.createElement('html')
  const listeners = new Set<() => void>()

  const query = {
    matches: prefersDark,
    addEventListener: (_type: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) =>
      listeners.delete(listener),
  }

  const window = fromPartial<Window>({
    matchMedia: () => fromPartial<MediaQueryList>(query),
    document: {documentElement: root},
  })

  return {
    window,
    root,
    switchTo(mode: ResolvedThemeMode) {
      query.matches = mode === 'dark'

      for (const listener of listeners) listener()
    },
  }
}

it('applies the accent of the mode the system prefers', () => {
  const {window, root} = fakeWindow(true)
  followColorScheme(undefined, window)
  expect(root.style.getPropertyValue('--primary')).toBe(hearth.dark?.primary)
  expect(root.dataset.mode).toBe('dark')
})

it('follows the system when it switches mode', () => {
  const {window, root, switchTo} = fakeWindow(true)
  followColorScheme(undefined, window)
  switchTo('light')
  expect(root.style.getPropertyValue('--primary')).toBe(hearth.light?.primary)
  expect(root.dataset.mode).toBe('light')
})

it('stops following once unsubscribed', () => {
  const {window, root, switchTo} = fakeWindow(false)
  const stop = followColorScheme(undefined, window)
  stop()
  switchTo('dark')
  expect(root.dataset.mode).toBe('light')
})

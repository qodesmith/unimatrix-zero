import {expect, it} from 'vitest'

import {followSystemMode} from './main'

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
  const window = {
    matchMedia: () => query,
    document: {documentElement: root},
  } as unknown as Window
  return {
    window,
    root,
    switchTo: (mode: 'light' | 'dark') => {
      query.matches = mode === 'dark'
      for (const listener of listeners) listener()
    },
  }
}

it('applies the clay accent of the mode the system prefers', () => {
  const {window, root} = fakeWindow(true)
  followSystemMode(undefined, window)
  expect(root.style.getPropertyValue('--primary')).toBe('#e07a52')
  expect(root.dataset.mode).toBe('dark')
})

it('follows the system when it switches mode', () => {
  const {window, root, switchTo} = fakeWindow(true)
  followSystemMode(undefined, window)
  switchTo('light')
  expect(root.style.getPropertyValue('--primary')).toBe('#c2562f')
  expect(root.dataset.mode).toBe('light')
})

it('stops following once unsubscribed', () => {
  const {window, root, switchTo} = fakeWindow(false)
  const stop = followSystemMode(undefined, window)
  stop()
  switchTo('dark')
  expect(root.dataset.mode).toBe('light')
})

import type {Mode, Theme, ThemeSet} from '@uz/contract/theme'

import {hearth} from './hearth'

function setForMode(theme: Theme, mode: Mode): ThemeSet {
  const set = theme[mode] ?? theme.light ?? theme.dark
  if (!set) throw new Error(`Theme "${theme.name}" has no token set`)
  return set
}

function applyThemeSet(set: ThemeSet, mode: Mode, root: HTMLElement) {
  for (const [token, value] of Object.entries(set)) {
    root.style.setProperty(`--${token}`, value)
  }
  root.dataset.mode = mode
  root.style.colorScheme = mode
}

/**
 * Writes the Theme's tokens onto `:root` for the system's mode and keeps
 * following the system.
 */
export function followSystemMode(
  theme: Theme = hearth,
  window: Window = globalThis.window
) {
  const query = window.matchMedia('(prefers-color-scheme: dark)')
  const apply = () => {
    const mode: Mode = query.matches ? 'dark' : 'light'
    applyThemeSet(
      setForMode(theme, mode),
      mode,
      window.document.documentElement
    )
  }
  apply()
  query.addEventListener('change', apply)
  return () => query.removeEventListener('change', apply)
}

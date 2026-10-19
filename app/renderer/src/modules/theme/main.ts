import type {Mode, Theme, ThemeSet} from './theme'

import {hearth} from './hearth'
import {setForMode} from './theme'

export type {Mode, Theme, ThemeSet} from './theme'
export {hearth}

/** Writes one token set onto `:root` as CSS variables and marks the mode. */
export function applyThemeSet(
  set: ThemeSet,
  mode: Mode,
  root = document.documentElement
) {
  for (const [token, value] of Object.entries(set)) {
    root.style.setProperty(`--${token}`, value)
  }
  root.dataset.mode = mode
  root.style.colorScheme = mode
}

/** Applies the Theme in the system's mode and keeps following the system. */
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

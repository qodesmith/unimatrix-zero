import type {ResolvedThemeMode, Theme, ThemeSet} from '@uz/contract/theme'

import {hearth} from './hearth'

function setForMode(theme: Theme, mode: ResolvedThemeMode): ThemeSet {
  const set = theme[mode] ?? theme.light ?? theme.dark

  if (!set) throw new Error(`Theme "${theme.name}" has no token set`)

  return set
}

/** The built-in Theme's Shiki theme names, light then dark. */
export function shikiThemes(): [string, string] {
  return [setForMode(hearth, 'light').shiki, setForMode(hearth, 'dark').shiki]
}

function applyThemeSet(
  set: ThemeSet,
  mode: ResolvedThemeMode,
  root: HTMLElement
) {
  for (const [token, value] of Object.entries(set)) {
    root.style.setProperty(`--${token}`, value)
  }

  root.dataset.mode = mode
  root.style.colorScheme = mode
}

/** Writes the Theme's tokens onto `:root` and follows the system's mode. */
export function followSystemMode(
  theme: Theme = hearth,
  window: Window = globalThis.window
) {
  const query = window.matchMedia('(prefers-color-scheme: dark)')

  function apply() {
    const mode: ResolvedThemeMode = query.matches ? 'dark' : 'light'
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

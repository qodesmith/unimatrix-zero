export type ThemeSet = {
  background: string
  foreground: string
  card: string
  'card-foreground': string
  popover: string
  'popover-foreground': string
  primary: string
  'primary-foreground': string
  secondary: string
  'secondary-foreground': string
  muted: string
  'muted-foreground': string
  accent: string
  'accent-foreground': string
  destructive: string
  border: string
  input: string
  ring: string
  sidebar: string
  'sidebar-foreground': string
  'sidebar-border': string
  'sidebar-accent': string
  'canvas-background': string
  'canvas-dots': string
  'canvas-edge': string
  'thread-highlight': string
  prompt: string
  'prompt-foreground': string
  radius: string
  font: string
  shiki: string
}

export type Mode = 'light' | 'dark'

/**
 * ADR 0009: a versioned document of token values with a light set, a dark set,
 * or both.
 */
export type Theme = {
  version: 1
  name: string
  light?: ThemeSet
  dark?: ThemeSet
}

export function setForMode(theme: Theme, mode: Mode): ThemeSet {
  const set = theme[mode] ?? theme.light ?? theme.dark
  if (!set) throw new Error(`Theme "${theme.name}" has no token set`)
  return set
}

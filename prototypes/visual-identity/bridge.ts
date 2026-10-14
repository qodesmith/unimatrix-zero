// PROTOTYPE: maps a Theme set onto the Tailwind palette the earlier prototypes hard-coded (zinc, violet, sky, status
// hues), so they reskin without being rewritten. The real app uses the tokens directly (ADR 0009); this mapping is
// throwaway. Fuchsia is left alone: it's prototype chrome. Throw away.
import type {Direction, ThemeSet} from './themes'

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const

const mix = (a: string, pct: number, b: string) =>
  `color-mix(in oklab, ${a} ${pct}%, ${b})`

// Neutral ramp from background to foreground, so it flips by itself in dark mode.
const NEUTRAL: Record<number, number> = {
  50: 3,
  100: 6,
  300: 20,
  400: 36,
  600: 66,
  700: 76,
  800: 86,
  950: 100,
}

// A hue ramp around one base: light steps lean to the background, dark steps to the foreground. In dark mode the two
// swap, so "bg-red-50 text-red-800" stays a quiet tint with readable text either way.
const TINT: Record<number, number> = {
  50: 10,
  100: 18,
  200: 32,
  300: 52,
  400: 76,
}
const SHADE: Record<number, number> = {
  600: 84,
  700: 68,
  800: 54,
  900: 42,
  950: 30,
}
function ramp(name: string, base: string, s: ThemeSet) {
  const out: Record<string, string> = {}
  for (const n of STEPS) {
    out[`--color-${name}-${n}`] =
      n === 500
        ? base
        : n < 500
          ? mix(base, TINT[n]!, s.background)
          : mix(base, SHADE[n]!, s.foreground)
  }
  return out
}

const STATUS = {
  amber: '#d98a0b',
  emerald: '#16a36a',
  orange: '#e8743b',
  blue: '#3b82f6',
  indigo: '#6366f1',
}

export function cssVars(set: ThemeSet, feel: Direction['feel']) {
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(set)) vars[`--${k}`] = v
  for (const n of STEPS) {
    vars[`--color-zinc-${n}`] =
      n === 200
        ? set.border
        : n === 500
          ? set['muted-foreground']
          : n === 900
            ? set.foreground
            : mix(set.foreground, NEUTRAL[n]!, set.background)
  }
  vars['--color-white'] = set.card
  Object.assign(
    vars,
    ramp('violet', set['thread-highlight'], set),
    ramp('red', set.destructive, set),
    ...Object.entries(STATUS).map(([k, v]) => ramp(k, v, set)),
    ramp('sky', mix(set['prompt-foreground'], 45, set.prompt), set)
  )
  // Prompt bubbles are sky-50/100 with sky-950 text in the earlier prototypes.
  vars['--color-sky-50'] = set.prompt
  vars['--color-sky-100'] = set.prompt
  vars['--color-sky-200'] = mix(set['prompt-foreground'], 14, set.prompt)
  vars['--color-sky-950'] = set['prompt-foreground']
  vars['--color-sky-900'] = set['prompt-foreground']

  const r = set.radius
  Object.assign(vars, {
    '--radius-xs': `calc(${r} * 0.2)`,
    '--radius-sm': `calc(${r} * 0.35)`,
    '--radius': r,
    '--radius-md': `calc(${r} * 0.55)`,
    '--radius-lg': `calc(${r} * 0.75)`,
    '--radius-xl': r,
    '--radius-2xl': `calc(${r} * 1.35)`,
    '--radius-3xl': `calc(${r} * 2)`,
    '--spacing': feel.density,
    '--font-sans': set.font,
    '--uz-weight': String(feel.weight),
    // React Flow and the file tree have their own variables.
    '--xy-background-color': set['canvas-background'],
    '--xy-edge-stroke': set['canvas-edge'],
    '--xy-controls-button-background-color': set.card,
    '--xy-controls-button-color': set.foreground,
    '--xy-controls-button-border-color': set.border,
    '--xy-minimap-background-color': set.card,
    '--xy-minimap-mask-background-color': mix(
      set.foreground,
      10,
      'transparent'
    ),
    '--xy-minimap-node-background-color': mix(set.foreground, 22, set.card),
    '--xy-selection-background-color': mix(
      set['thread-highlight'],
      6,
      'transparent'
    ),
    '--xy-selection-border': `1px dashed ${mix(set['thread-highlight'], 60, 'transparent')}`,
    '--trees-bg-override': 'transparent',
    '--trees-fg-override': set['sidebar-foreground'],
    '--trees-fg-muted-override': set['muted-foreground'],
    '--trees-bg-muted-override': set['sidebar-accent'],
    '--trees-border-color-override': set['sidebar-border'],
    '--trees-accent-override': set['thread-highlight'],
    '--trees-border-radius-override': `calc(${r} * 0.55)`,
  })
  return vars
}

export const isDark = (bg: string) => {
  const h = bg.replace('#', '')
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  return 0.299 * r! + 0.587 * g! + 0.114 * b! < 128
}

let applied: string[] = []
export function applyTheme(set: ThemeSet, feel: Direction['feel']) {
  const root = document.documentElement
  for (const k of applied) root.style.removeProperty(k)
  const vars = cssVars(set, feel)
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v)
  applied = Object.keys(vars)
  const dark = isDark(set.background)
  root.style.colorScheme = dark ? 'dark' : 'light'
  root.style.setProperty('--uz-scheme', dark ? 'dark' : 'light')
  root.dataset.mode = dark ? 'dark' : 'light'
  applied.push('--uz-scheme')
}

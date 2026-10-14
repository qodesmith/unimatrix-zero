// PROTOTYPE: the four directions as Themes in the ADR 0009 shape (version, light set, dark set, token values only).
// `feel` sits outside the Theme on purpose: density isn't a Theme token, so whichever direction wins sets it for the
// whole app. Throw away.

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

export type Theme = {
  version: 1
  name: string
  light?: ThemeSet
  dark?: ThemeSet
}

export type Direction = {
  key: string
  name: string
  pitch: string
  theme: Theme
  feel: {density: string; weight: number; fonts: string}
}

const WARM_FONT = "'Figtree', ui-sans-serif, system-ui, sans-serif"
const COOL_FONT = "'Geist', ui-sans-serif, system-ui, sans-serif"
const PLAY_FONT = "'Nunito', ui-rounded, ui-sans-serif, system-ui, sans-serif"
const BORG_FONT = "'Chakra Petch', ui-sans-serif, system-ui, sans-serif"

export const DIRECTIONS: Direction[] = [
  {
    key: 'A',
    name: 'Calm, warm neutral',
    pitch:
      'shadcn base, warm greys, one clay accent, soft radius, roomy. tldraw-like friendliness.',
    feel: {density: '0.27rem', weight: 400, fonts: 'Figtree'},
    theme: {
      version: 1,
      name: 'Hearth',
      light: {
        background: '#faf8f5',
        foreground: '#2b2622',
        card: '#fffdfa',
        'card-foreground': '#2b2622',
        popover: '#fffdfa',
        'popover-foreground': '#2b2622',
        primary: '#c2562f',
        'primary-foreground': '#fffaf5',
        secondary: '#f1ebe3',
        'secondary-foreground': '#2b2622',
        muted: '#f3eee8',
        'muted-foreground': '#7a6f66',
        accent: '#f1ebe3',
        'accent-foreground': '#2b2622',
        destructive: '#c8352b',
        border: '#e7e0d7',
        input: '#ddd4c9',
        ring: '#c2562f',
        sidebar: '#f4efe9',
        'sidebar-foreground': '#2b2622',
        'sidebar-border': '#e7e0d7',
        'sidebar-accent': '#ebe3d9',
        'canvas-background': '#f8f5f0',
        'canvas-dots': '#e0d8cd',
        'canvas-edge': '#c7bcae',
        'thread-highlight': '#c2562f',
        prompt: '#f3e7dc',
        'prompt-foreground': '#3d2a1c',
        radius: '0.75rem',
        font: WARM_FONT,
        shiki: 'rose-pine-dawn',
      },
      dark: {
        background: '#1c1916',
        foreground: '#ede6dd',
        card: '#25211d',
        'card-foreground': '#ede6dd',
        popover: '#25211d',
        'popover-foreground': '#ede6dd',
        primary: '#e07a52',
        'primary-foreground': '#1c1916',
        secondary: '#2e2924',
        'secondary-foreground': '#ede6dd',
        muted: '#2a2521',
        'muted-foreground': '#a59a8f',
        accent: '#2e2924',
        'accent-foreground': '#ede6dd',
        destructive: '#e5604f',
        border: '#3a342e',
        input: '#443d36',
        ring: '#e07a52',
        sidebar: '#181512',
        'sidebar-foreground': '#ede6dd',
        'sidebar-border': '#332d28',
        'sidebar-accent': '#2a2521',
        'canvas-background': '#1a1714',
        'canvas-dots': '#342e28',
        'canvas-edge': '#5a5048',
        'thread-highlight': '#e07a52',
        prompt: '#3a2b20',
        'prompt-foreground': '#f3e3d3',
        radius: '0.75rem',
        font: WARM_FONT,
        shiki: 'rose-pine',
      },
    },
  },
  {
    key: 'B',
    name: 'Cool, tool-like',
    pitch:
      'Linear/Vercel: zinc, crisp 1px lines, small radius, dense. One indigo for the active Thread.',
    feel: {density: '0.22rem', weight: 400, fonts: 'Geist'},
    theme: {
      version: 1,
      name: 'Graphite',
      light: {
        background: '#ffffff',
        foreground: '#09090b',
        card: '#ffffff',
        'card-foreground': '#09090b',
        popover: '#ffffff',
        'popover-foreground': '#09090b',
        primary: '#18181b',
        'primary-foreground': '#fafafa',
        secondary: '#f4f4f5',
        'secondary-foreground': '#18181b',
        muted: '#f4f4f5',
        'muted-foreground': '#71717a',
        accent: '#f4f4f5',
        'accent-foreground': '#18181b',
        destructive: '#dc2626',
        border: '#e4e4e7',
        input: '#e4e4e7',
        ring: '#5e6ad2',
        sidebar: '#fafafa',
        'sidebar-foreground': '#09090b',
        'sidebar-border': '#e4e4e7',
        'sidebar-accent': '#f0f0f2',
        'canvas-background': '#fafafa',
        'canvas-dots': '#e4e4e7',
        'canvas-edge': '#a1a1aa',
        'thread-highlight': '#5e6ad2',
        prompt: '#f4f4f5',
        'prompt-foreground': '#18181b',
        radius: '0.375rem',
        font: COOL_FONT,
        shiki: 'github-light-default',
      },
      dark: {
        background: '#09090b',
        foreground: '#fafafa',
        card: '#111113',
        'card-foreground': '#fafafa',
        popover: '#111113',
        'popover-foreground': '#fafafa',
        primary: '#fafafa',
        'primary-foreground': '#09090b',
        secondary: '#1c1c1f',
        'secondary-foreground': '#fafafa',
        muted: '#18181b',
        'muted-foreground': '#a1a1aa',
        accent: '#1c1c1f',
        'accent-foreground': '#fafafa',
        destructive: '#ef4444',
        border: '#27272a',
        input: '#27272a',
        ring: '#7c84e8',
        sidebar: '#0c0c0e',
        'sidebar-foreground': '#fafafa',
        'sidebar-border': '#232326',
        'sidebar-accent': '#18181b',
        'canvas-background': '#0b0b0d',
        'canvas-dots': '#222226',
        'canvas-edge': '#52525b',
        'thread-highlight': '#7c84e8',
        prompt: '#1c1c1f',
        'prompt-foreground': '#e4e4e7',
        radius: '0.375rem',
        font: COOL_FONT,
        shiki: 'github-dark-default',
      },
    },
  },
  {
    key: 'C',
    name: 'Playful',
    pitch:
      'Bright colours, big rounded shapes, chunky type. Coral buttons, purple Threads, sunny Prompts.',
    feel: {density: '0.28rem', weight: 600, fonts: 'Nunito'},
    theme: {
      version: 1,
      name: 'Sherbet',
      light: {
        background: '#fff9ef',
        foreground: '#22134d',
        card: '#ffffff',
        'card-foreground': '#22134d',
        popover: '#ffffff',
        'popover-foreground': '#22134d',
        primary: '#ff4f6d',
        'primary-foreground': '#ffffff',
        secondary: '#ffefc7',
        'secondary-foreground': '#22134d',
        muted: '#fdf0dc',
        'muted-foreground': '#7a6896',
        accent: '#ffefc7',
        'accent-foreground': '#22134d',
        destructive: '#e5263f',
        border: '#f1dfc2',
        input: '#ecd5b0',
        ring: '#7b5cff',
        sidebar: '#fff1d9',
        'sidebar-foreground': '#22134d',
        'sidebar-border': '#f1dfc2',
        'sidebar-accent': '#ffe3ad',
        'canvas-background': '#fff6e6',
        'canvas-dots': '#f3d9ad',
        'canvas-edge': '#c9b3e6',
        'thread-highlight': '#7b5cff',
        prompt: '#ffe066',
        'prompt-foreground': '#3a2a00',
        radius: '1.25rem',
        font: PLAY_FONT,
        shiki: 'catppuccin-latte',
      },
      dark: {
        background: '#1b1438',
        foreground: '#fff4e3',
        card: '#251c4a',
        'card-foreground': '#fff4e3',
        popover: '#251c4a',
        'popover-foreground': '#fff4e3',
        primary: '#ff6f86',
        'primary-foreground': '#1b1438',
        secondary: '#2f2560',
        'secondary-foreground': '#fff4e3',
        muted: '#2a2155',
        'muted-foreground': '#b9aadf',
        accent: '#2f2560',
        'accent-foreground': '#fff4e3',
        destructive: '#ff5068',
        border: '#3a2f70',
        input: '#463a85',
        ring: '#a68cff',
        sidebar: '#150f2e',
        'sidebar-foreground': '#fff4e3',
        'sidebar-border': '#2f2560',
        'sidebar-accent': '#2a2155',
        'canvas-background': '#18112f',
        'canvas-dots': '#33296a',
        'canvas-edge': '#5f4fa3',
        'thread-highlight': '#a68cff',
        prompt: '#f7c948',
        'prompt-foreground': '#1b1438',
        radius: '1.25rem',
        font: PLAY_FONT,
        shiki: 'catppuccin-mocha',
      },
    },
  },
  {
    key: 'D',
    name: 'Sci-fi / Borg',
    pitch:
      'Green on black, leaning into the name. Square corners, technical type, glowing active Thread.',
    feel: {density: '0.24rem', weight: 500, fonts: 'Chakra Petch'},
    theme: {
      version: 1,
      name: 'Unimatrix',
      light: {
        background: '#eef3ef',
        foreground: '#0a1f10',
        card: '#f7faf7',
        'card-foreground': '#0a1f10',
        popover: '#f7faf7',
        'popover-foreground': '#0a1f10',
        primary: '#0a1f10',
        'primary-foreground': '#5dff8a',
        secondary: '#dfe9e1',
        'secondary-foreground': '#0a1f10',
        muted: '#e3ece5',
        'muted-foreground': '#4d6b55',
        accent: '#dfe9e1',
        'accent-foreground': '#0a1f10',
        destructive: '#c4262e',
        border: '#c3d4c7',
        input: '#b3c8b8',
        ring: '#0f9a44',
        sidebar: '#e4ece6',
        'sidebar-foreground': '#0a1f10',
        'sidebar-border': '#c3d4c7',
        'sidebar-accent': '#d4e2d7',
        'canvas-background': '#e9f0ea',
        'canvas-dots': '#bfd2c3',
        'canvas-edge': '#8fac97',
        'thread-highlight': '#0f9a44',
        prompt: '#d5e7d9',
        'prompt-foreground': '#0a1f10',
        radius: '0.125rem',
        font: BORG_FONT,
        shiki: 'min-light',
      },
      dark: {
        background: '#030805',
        foreground: '#b8f5c6',
        card: '#07110a',
        'card-foreground': '#b8f5c6',
        popover: '#07110a',
        'popover-foreground': '#b8f5c6',
        primary: '#39ff6a',
        'primary-foreground': '#021006',
        secondary: '#0b1d10',
        'secondary-foreground': '#b8f5c6',
        muted: '#0a170d',
        'muted-foreground': '#4f9a62',
        accent: '#0b1d10',
        'accent-foreground': '#b8f5c6',
        destructive: '#ff4d4d',
        border: '#13361c',
        input: '#18452a',
        ring: '#39ff6a',
        sidebar: '#020604',
        'sidebar-foreground': '#b8f5c6',
        'sidebar-border': '#0f2a16',
        'sidebar-accent': '#0a1a0e',
        'canvas-background': '#010402',
        'canvas-dots': '#0e2a15',
        'canvas-edge': '#1d5a2e',
        'thread-highlight': '#39ff6a',
        prompt: '#0c2613',
        'prompt-foreground': '#c8ffd6',
        radius: '0.125rem',
        font: BORG_FONT,
        shiki: 'vitesse-black',
      },
    },
  },
]

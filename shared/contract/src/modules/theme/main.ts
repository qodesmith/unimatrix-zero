import {z} from 'zod'

const color = z.string()

export const ThemeSetSchema = z.object({
  background: color,
  foreground: color,
  card: color,
  'card-foreground': color,
  popover: color,
  'popover-foreground': color,
  primary: color,
  'primary-foreground': color,
  secondary: color,
  'secondary-foreground': color,
  muted: color,
  'muted-foreground': color,
  accent: color,
  'accent-foreground': color,
  destructive: color,
  border: color,
  input: color,
  ring: color,
  sidebar: color,
  'sidebar-foreground': color,
  'sidebar-border': color,
  'sidebar-accent': color,
  'canvas-background': color,
  'canvas-dots': color,
  'canvas-edge': color,
  'thread-highlight': color,
  prompt: color,
  'prompt-foreground': color,
  radius: z.string(),
  font: z.string(),
  shiki: z.string(),
})

/**
 * A Theme is token values only, with a light set, a dark set, or both. Unknown
 * keys are dropped.
 */
export const ThemeSchema = z
  .object({
    version: z.literal(1),
    name: z.string().min(1),
    light: ThemeSetSchema.optional(),
    dark: ThemeSetSchema.optional(),
  })
  .refine(
    theme => theme.light || theme.dark,
    'A Theme needs a light set, a dark set, or both'
  )

export type ThemeSet = z.infer<typeof ThemeSetSchema>
export type Theme = z.infer<typeof ThemeSchema>
export type Mode = 'light' | 'dark'

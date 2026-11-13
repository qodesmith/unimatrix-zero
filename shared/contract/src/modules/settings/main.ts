import type {ProviderId} from '#modules/providers/main'

import {z} from 'zod'

export const CanvasOrientationSchema = z.enum(['vertical', 'horizontal'])

export type CanvasOrientation = z.infer<typeof CanvasOrientationSchema>

export const ThemeModeSchema = z.enum(['system', 'light', 'dark'])

export type ThemeMode = z.infer<typeof ThemeModeSchema>

/**
 * `enter`: Enter sends, Shift+Enter breaks a line. `mod-enter`: ⌘/Ctrl+Enter
 * sends.
 */
export const SendKeySchema = z.enum(['enter', 'mod-enter'])

/** In pixels. */
export const FONT_SIZE = {min: 12, max: 24, step: 2}

/**
 * In tokens, the range each Provider takes. Codex's `max` is 90% of its
 * largest Model's raw Context window, past which it clamps.
 */
export const COMPACTION_THRESHOLD = {
  claude: {min: 100_000, max: 1_000_000},
  chatgpt: {min: 20_000, max: 450_000},
} satisfies Record<ProviderId, {min: number; max: number}>

/** Null leaves it to the Provider: the Model's own limit. */
function thresholdSchema({min, max}: {min: number; max: number}) {
  return z.int().min(min).max(max).nullable()
}

/**
 * Global, never per Tree. Only the Compaction Settings change what the AI
 * does, in every Thread from its next Reply.
 */
export const SettingsSchema = z.strictObject({
  themeMode: ThemeModeSchema,
  canvasOrientation: CanvasOrientationSchema,
  limitTurnHeight: z.boolean(),
  contextSizeMeter: z.boolean(),
  fontSize: z
    .int()
    .min(FONT_SIZE.min)
    .max(FONT_SIZE.max)
    .multipleOf(FONT_SIZE.step),
  sendKey: SendKeySchema,
  /** The note above the Input before a step that re-reads the Thread cold. */
  reReadNote: z.boolean(),
  escStopsReply: z.boolean(),
  /** Automatic Compaction; a Prompt of `/compact` still compacts. */
  claudeAutoCompaction: z.boolean(),
  claudeCompactionThreshold: thresholdSchema(COMPACTION_THRESHOLD.claude),
  chatgptCompactionThreshold: thresholdSchema(COMPACTION_THRESHOLD.chatgpt),
})

export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'system',
  canvasOrientation: 'vertical',
  limitTurnHeight: true,
  contextSizeMeter: true,
  fontSize: 16,
  sendKey: 'enter',
  reReadNote: true,
  escStopsReply: true,
  claudeAutoCompaction: true,
  claudeCompactionThreshold: null,
  chatgptCompactionThreshold: null,
}

export const SettingsUpdateSchema = SettingsSchema.partial()

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>

/** When a Provider compacts a Thread, as each Reply is sent with it. */
export const CompactionSettingsSchema = z.strictObject({
  /** False only for a Provider that can turn automatic Compaction off. */
  auto: z.boolean(),
  threshold: z.int().positive().nullable(),
})

export type CompactionSettings = z.infer<typeof CompactionSettingsSchema>

export function compactionSettingsFor(
  settings: Settings,
  provider: ProviderId
): CompactionSettings {
  switch (provider) {
    case 'claude':
      return {
        auto: settings.claudeAutoCompaction,
        threshold: settings.claudeCompactionThreshold,
      }
    case 'chatgpt':
      return {auto: true, threshold: settings.chatgptCompactionThreshold}
    default:
      throw new Error('Unknown Provider.')
  }
}

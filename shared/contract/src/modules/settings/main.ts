import type {ProviderId} from '#modules/providers/main'

import {SystemPromptEntryIdSchema} from '#modules/system-prompts/main'
import {DEFAULT_TREE_TOOLS, TreeToolsSchema} from '#modules/tools/main'
import {z} from 'zod'

export const CanvasOrientationSchema = z.enum(['vertical', 'horizontal'])

export type CanvasOrientation = z.infer<typeof CanvasOrientationSchema>

export const ThemeModeSchema = z.enum(['system', 'light', 'dark'])

export type ThemeMode = z.infer<typeof ThemeModeSchema>

export const SendKeySchema = z.enum(['enter', 'mod-enter'])

export const FONT_SIZE = {min: 12, max: 24, step: 2}

export interface CompactionThresholdRange {
  min: number
  max: number
}

/**
 * In tokens, the range each Provider takes. Codex's `max` is 90% of its
 * largest Model's raw Context window, past which it clamps.
 */
export const COMPACTION_THRESHOLD = {
  claude: {min: 100_000, max: 1_000_000},
  chatgpt: {min: 20_000, max: 450_000},
} satisfies Record<ProviderId, CompactionThresholdRange>

function thresholdSchema({min, max}: CompactionThresholdRange) {
  return z.int().min(min).max(max).nullable()
}

/**
 * The Compaction Settings reach every Thread from its next Reply, and no Tree
 * has its own; the default System prompt and the Tools defaults reach only
 * Trees created later; every other key never reaches the AI (ADR 0023).
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
  reReadNote: z.boolean(),
  escStopsReply: z.boolean(),
  claudeAutoCompaction: z.boolean(),
  claudeCompactionThreshold: thresholdSchema(COMPACTION_THRESHOLD.claude),
  chatgptCompactionThreshold: thresholdSchema(COMPACTION_THRESHOLD.chatgpt),
  defaultSystemPromptId: SystemPromptEntryIdSchema,
  toolDefaults: TreeToolsSchema,
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
  defaultSystemPromptId: 'default',
  toolDefaults: DEFAULT_TREE_TOOLS,
}

export const SettingsUpdateSchema = SettingsSchema.partial()

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>

export const CompactionSettingsSchema = z.strictObject({
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

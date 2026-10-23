import {z} from 'zod'

export const CanvasOrientationSchema = z.enum(['vertical', 'horizontal'])

export type CanvasOrientation = z.infer<typeof CanvasOrientationSchema>

/**
 * The user's global preferences (PRD §17). Visual and behavior Settings are
 * never per Tree; a Setting changes nothing about what the AI does.
 */
export const SettingsSchema = z.strictObject({
  canvasOrientation: CanvasOrientationSchema,
  /** Long Prompts and Replies scroll inside a capped height. */
  limitMessageHeight: z.boolean(),
  /** A thin bar on each Reply toward the Model's context window. */
  contextSizeMeter: z.boolean(),
})

export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  canvasOrientation: 'vertical',
  limitMessageHeight: true,
  contextSizeMeter: true,
}

/** The Settings a command changes; the rest keep their values. */
export const SettingsUpdateSchema = SettingsSchema.partial()

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>

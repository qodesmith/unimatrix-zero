import {z} from 'zod'

export const CanvasOrientationSchema = z.enum(['vertical', 'horizontal'])

export type CanvasOrientation = z.infer<typeof CanvasOrientationSchema>

/** Global, never per Tree; a Setting changes nothing about what the AI does. */
export const SettingsSchema = z.strictObject({
  canvasOrientation: CanvasOrientationSchema,
  /** Long Prompts and Replies scroll inside a capped height. */
  limitTurnHeight: z.boolean(),
  /** A thin bar on each Reply toward the Context window. */
  contextSizeMeter: z.boolean(),
})

export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  canvasOrientation: 'vertical',
  limitTurnHeight: true,
  contextSizeMeter: true,
}

export const SettingsUpdateSchema = SettingsSchema.partial()

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>

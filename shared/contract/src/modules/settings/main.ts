import {z} from 'zod'

export const CanvasOrientationSchema = z.enum(['vertical', 'horizontal'])

export type CanvasOrientation = z.infer<typeof CanvasOrientationSchema>

/** Which set of the Theme shows; `system` follows the operating system. */
export const ThemeModeSchema = z.enum(['system', 'light', 'dark'])

export type ThemeMode = z.infer<typeof ThemeModeSchema>

/**
 * `enter`: Enter sends, Shift+Enter breaks a line. `mod-enter`: ⌘/Ctrl+Enter
 * sends.
 */
export const SendKeySchema = z.enum(['enter', 'mod-enter'])

/** Global, never per Tree; a Setting changes nothing about what the AI does. */
export const SettingsSchema = z.strictObject({
  themeMode: ThemeModeSchema,
  canvasOrientation: CanvasOrientationSchema,
  /** Long Prompts and Replies scroll inside a capped height. */
  limitTurnHeight: z.boolean(),
  /** A thin bar on each Reply toward the Context window. */
  contextSizeMeter: z.boolean(),
  sendKey: SendKeySchema,
  /** The note above the Input before a step that re-reads the Thread cold. */
  reReadNote: z.boolean(),
})

export type Settings = z.infer<typeof SettingsSchema>

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'system',
  canvasOrientation: 'vertical',
  limitTurnHeight: true,
  contextSizeMeter: true,
  sendKey: 'enter',
  reReadNote: true,
}

export const SettingsUpdateSchema = SettingsSchema.partial()

export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>

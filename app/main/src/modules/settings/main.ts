import type {Database} from '#modules/database/main'
import type {Settings, SettingsUpdate} from '@uz/contract/settings'

import {schema} from '#modules/database/main'
import {DEFAULT_SETTINGS, SettingsSchema} from '@uz/contract/settings'
import {eq} from 'drizzle-orm'
import {z} from 'zod'

type SettingKey = keyof Settings

function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SettingsSchema.shape, key)
}

const KEYS = Object.keys(SettingsSchema.shape).filter(isSettingKey)

/** Not a Setting: ⌘+ and ⌘− change it, and it lives beside the Settings. */
const ZOOM_KEY = 'zoomFactor'

const ZoomFactorSchema = z.number().min(0.25).max(5)

export type SettingsStore = ReturnType<typeof createSettings>

/**
 * One row per key; a value that no longer fits its schema reads as the
 * default. `onSaved` hears every Setting after each update.
 */
export function createSettings(
  db: Database,
  onSaved?: (saved: Settings) => void
) {
  const {settings} = schema

  function read(): Settings {
    const rows = db.select().from(settings).all()
    const result: Settings = {...DEFAULT_SETTINGS}

    for (const key of KEYS) {
      const row = rows.find(candidate => candidate.key === key)
      const parsed = SettingsSchema.shape[key].safeParse(row?.value)

      if (parsed.success) {
        // Each key's schema is the type of its own field.
        Object.assign(result, {[key]: parsed.data})
      }
    }

    return result
  }

  function write(
    into: Pick<Database, 'insert'>,
    key: string,
    value: Settings[SettingKey] | number
  ) {
    into
      .insert(settings)
      .values({key, value})
      .onConflictDoUpdate({target: settings.key, set: {value}})
      .run()
  }

  return {
    read,

    update(changes: SettingsUpdate): Settings {
      db.transaction(tx => {
        for (const key of KEYS) {
          const value = changes[key]

          if (value !== undefined) write(tx, key, value)
        }
      })

      const saved = read()
      onSaved?.(saved)

      return saved
    },

    readZoomFactor(): number {
      const row = db
        .select()
        .from(settings)
        .where(eq(settings.key, ZOOM_KEY))
        .get()

      const parsed = ZoomFactorSchema.safeParse(row?.value)

      return parsed.success ? parsed.data : 1
    },

    saveZoomFactor(factor: number) {
      write(db, ZOOM_KEY, factor)
    },
  }
}

import type {Database} from '#modules/database/main'
import type {Settings, SettingsUpdate} from '@uz/contract/settings'

import {schema} from '#modules/database/main'
import {DEFAULT_SETTINGS, SettingsSchema} from '@uz/contract/settings'

type SettingKey = keyof Settings

function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(SettingsSchema.shape, key)
}

const KEYS = Object.keys(SettingsSchema.shape).filter(isSettingKey)

export type SettingsStore = ReturnType<typeof createSettings>

/** One row per key; a value that no longer fits its schema reads as the default. */
export function createSettings(db: Database) {
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

  return {
    read,

    update(changes: SettingsUpdate): Settings {
      db.transaction(tx => {
        for (const key of KEYS) {
          const value = changes[key]

          if (value === undefined) continue

          tx.insert(settings)
            .values({key, value})
            .onConflictDoUpdate({target: settings.key, set: {value}})
            .run()
        }
      })

      return read()
    },
  }
}

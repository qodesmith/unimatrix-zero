import type {Database} from '#modules/database/main'
import type {Layout, LayoutUpdate} from '@uz/contract/layout'

import {schema} from '#modules/database/main'
import {DEFAULT_LAYOUT, LayoutSchema} from '@uz/contract/layout'

type LayoutKey = keyof Layout

function isLayoutKey(key: string): key is LayoutKey {
  return Object.hasOwn(LayoutSchema.shape, key)
}

const KEYS = Object.keys(LayoutSchema.shape).filter(isLayoutKey)

export type LayoutStore = ReturnType<typeof createLayout>

/** One row per key; a value that no longer fits its schema reads as the default. */
export function createLayout(db: Database) {
  const {layout} = schema

  function read(): Layout {
    const rows = db.select().from(layout).all()
    const result: Layout = {...DEFAULT_LAYOUT}

    for (const key of KEYS) {
      const row = rows.find(candidate => candidate.key === key)
      const parsed = LayoutSchema.shape[key].safeParse(row?.value)

      if (parsed.success) {
        // Each key's schema is the type of its own field.
        Object.assign(result, {[key]: parsed.data})
      }
    }

    return result
  }

  return {
    read,

    update(changes: LayoutUpdate): Layout {
      db.transaction(tx => {
        for (const key of KEYS) {
          const value = changes[key]

          if (value === undefined) continue

          tx.insert(layout)
            .values({key, value})
            .onConflictDoUpdate({target: layout.key, set: {value}})
            .run()
        }
      })

      return read()
    },
  }
}

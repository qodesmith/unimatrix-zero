import type {Database} from '#modules/database/main'
import type {SettingsStore} from '#modules/settings/main'
import type {Settings} from '@uz/contract/settings'
import type {
  SystemPromptEntry,
  SystemPromptLibrary,
} from '@uz/contract/system-prompts'

import {schema} from '#modules/database/main'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import {
  PRESETS,
  PresetIdSchema,
  defaultEntry,
} from '@uz/contract/system-prompts'
import {asc, eq} from 'drizzle-orm'
import {createHash} from 'node:crypto'

const {systemPromptLibrary, systemPrompts} = schema

/** Append-only by hash: the same text is always the same row. */
export function saveSystemPrompt(db: Database, text: string): string {
  const hash = createHash('sha256').update(text).digest('hex')

  db.insert(systemPrompts).values({hash, text}).onConflictDoNothing().run()

  const row = db
    .select({id: systemPrompts.id})
    .from(systemPrompts)
    .where(eq(systemPrompts.hash, hash))
    .get()

  if (!row) throw new Error('The System prompt was not saved.')

  return row.id
}

type NamedText = Pick<SystemPromptEntry, 'name' | 'text'>

type LibraryRow = typeof systemPromptLibrary.$inferSelect

function toEntry({id, name, text}: LibraryRow): SystemPromptEntry {
  return {id, name, text, preset: false}
}

function refusePreset(id: string, change: string) {
  if (PresetIdSchema.safeParse(id).success) {
    throw new Error(
      `A preset can’t be ${change}. Duplicate it to make one of your own.`
    )
  }
}

export type SystemPrompts = ReturnType<typeof createSystemPrompts>

/** The library: the presets, then the user's own. Changing it changes no Tree. */
export function createSystemPrompts(db: Database, settings: SettingsStore) {
  function list(): SystemPromptLibrary {
    const own = db
      .select()
      .from(systemPromptLibrary)
      .orderBy(asc(systemPromptLibrary.createdAt), asc(systemPromptLibrary.id))
      .all()
      .map(toEntry)

    return {entries: [...PRESETS, ...own]}
  }

  return {
    list,

    create({name, text}: NamedText, now: Date): SystemPromptEntry {
      return toEntry(
        db
          .insert(systemPromptLibrary)
          .values({name, text, createdAt: now})
          .returning()
          .get()
      )
    },

    /** Null for an entry the library doesn't have. */
    update(id: string, {name, text}: NamedText): SystemPromptEntry | null {
      refusePreset(id, 'changed')

      const row = db
        .update(systemPromptLibrary)
        .set({name, text})
        .where(eq(systemPromptLibrary.id, id))
        .returning()
        .get()

      return row ? toEntry(row) : null
    },

    /**
     * Null for an entry the library doesn't have. Deleting the default for new
     * Trees puts the Default preset back, and answers with the Settings saved.
     */
    delete(id: string): {settings: Settings | null} | null {
      refusePreset(id, 'deleted')

      const row = db
        .delete(systemPromptLibrary)
        .where(eq(systemPromptLibrary.id, id))
        .returning({id: systemPromptLibrary.id})
        .get()

      if (!row) return null

      const wasDefault = settings.read().defaultSystemPromptId === id

      return {
        settings: wasDefault
          ? settings.update({
              defaultSystemPromptId: DEFAULT_SETTINGS.defaultSystemPromptId,
            })
          : null,
      }
    },

    /** What a new Tree copies. */
    defaultText(): string {
      return defaultEntry(list().entries, settings.read().defaultSystemPromptId)
        .text
    },
  }
}

import type {Database} from '#modules/database/main'
import type {SettingsStore} from '#modules/settings/main'

import {openDatabase} from '#modules/database/main'
import {createSettings} from '#modules/settings/main'
import {PRESETS} from '@uz/contract/system-prompts'
import path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'

import {createSystemPrompts} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

let db: Database
let settings: SettingsStore
let library: ReturnType<typeof createSystemPrompts>

beforeEach(() => {
  db = openDatabase({file: ':memory:', migrationsFolder})
  settings = createSettings(db)
  library = createSystemPrompts(db, settings)
})

function names() {
  return library.list().entries.map(entry => entry.name)
}

describe('the library', () => {
  it('lists the presets, then the user’s own oldest first', () => {
    library.create({name: 'Pirate', text: 'Talk like a pirate.'}, new Date(2))
    library.create({name: 'Haiku', text: 'Answer in haiku.'}, new Date(1))

    expect(names()).toEqual([
      ...PRESETS.map(entry => entry.name),
      'Haiku',
      'Pirate',
    ])
  })

  it('changes and deletes the user’s own, and answers null for one it doesn’t have', () => {
    const {id} = library.create({name: 'Pirate', text: 'Arr.'}, new Date())

    expect(library.update(id, {name: 'Sailor', text: 'Ahoy.'})).toEqual({
      id,
      name: 'Sailor',
      text: 'Ahoy.',
      preset: false,
    })
    expect(library.list().entries.at(-1)).toMatchObject({text: 'Ahoy.'})
    expect(library.delete(id)).toEqual({settings: null})
    expect(names()).not.toContain('Sailor')
    expect(library.update(id, {name: 'Sailor', text: 'Ahoy.'})).toBeNull()
    expect(library.delete(id)).toBeNull()
  })
})

describe('the default for new Trees', () => {
  it('is the text of the entry the Setting names', () => {
    const {id} = library.create({name: 'Pirate', text: 'Arr.'}, new Date())
    settings.update({defaultSystemPromptId: id})

    expect(library.defaultText()).toBe('Arr.')
  })

  it('falls back to the Default preset for an id no entry has', () => {
    settings.update({defaultSystemPromptId: crypto.randomUUID()})

    expect(library.defaultText()).toBe(
      PRESETS.find(entry => entry.id === 'default')?.text
    )
  })
})

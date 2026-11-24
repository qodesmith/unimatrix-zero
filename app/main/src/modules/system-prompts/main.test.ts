import type {Database} from '#modules/database/main'
import type {SettingsStore} from '#modules/settings/main'

import {openDatabase} from '#modules/database/main'
import {createSettings} from '#modules/settings/main'
import path from 'node:path'
import {beforeEach, describe, expect, it} from 'vitest'

import {createSystemPrompts, saveSystemPrompt} from './main'

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
      'Default',
      'Concise',
      'Explain simply',
      'Coding helper',
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

  it('refuses to change or delete a preset', () => {
    expect(() => library.update('concise', {name: 'Mine', text: 'x'})).toThrow(
      /preset/
    )
    expect(() => library.delete('concise')).toThrow(/preset/)
    expect(library.list().entries[1]).toMatchObject({
      name: 'Concise',
      text: expect.stringMatching(/^Answer as briefly/),
    })
  })
})

describe('the default for new Trees', () => {
  it('is the text of the entry the Setting names', () => {
    const {id} = library.create({name: 'Pirate', text: 'Arr.'}, new Date())
    settings.update({defaultSystemPromptId: id})

    expect(library.defaultText()).toBe('Arr.')
  })

  it('falls back to the Default preset, and the Setting with it, once its entry is deleted', () => {
    const {id} = library.create({name: 'Pirate', text: 'Arr.'}, new Date())
    settings.update({defaultSystemPromptId: id})

    const deleted = library.delete(id)

    expect(deleted?.settings?.defaultSystemPromptId).toBe('default')
    expect(settings.read().defaultSystemPromptId).toBe('default')
    expect(library.defaultText()).toMatch(/^You are a helpful assistant/)
  })

  it('falls back to the Default preset for an id no entry has', () => {
    settings.update({defaultSystemPromptId: crypto.randomUUID()})

    expect(library.defaultText()).toMatch(/^You are a helpful assistant/)
  })
})

describe('saving a System prompt', () => {
  it('keeps one row for the same text, and a new one for new text', () => {
    const first = saveSystemPrompt(db, 'Be brief.')

    expect(saveSystemPrompt(db, 'Be brief.')).toBe(first)
    expect(saveSystemPrompt(db, 'Be briefer.')).not.toBe(first)
  })
})

import type {Settings} from '@uz/contract/settings'

import {openDatabase, schema} from '#modules/database/main'
import {DEFAULT_SETTINGS} from '@uz/contract/settings'
import path from 'node:path'
import {beforeEach, expect, it} from 'vitest'

import {createSettings} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

let db: ReturnType<typeof openDatabase>

beforeEach(() => {
  db = openDatabase({file: ':memory:', migrationsFolder})
})

it('keeps a change across reopening and leaves the other Settings alone', () => {
  const others = {
    themeMode: 'dark',
    limitTurnHeight: false,
    contextSizeMeter: false,
    fontSize: 20,
    sendKey: 'mod-enter',
    reReadNote: false,
    escStopsReply: false,
    claudeAutoCompaction: false,
    claudeCompactionThreshold: 150_000,
    chatgptCompactionThreshold: 50_000,
  } as const

  createSettings(db).update(others)
  createSettings(db).update({canvasOrientation: 'horizontal'})

  expect(createSettings(db).read()).toEqual({
    ...others,
    canvasOrientation: 'horizontal',
  })
})

it('answers an update with every Setting as now saved', () => {
  const settings = createSettings(db)
  settings.update({
    canvasOrientation: 'horizontal',
    themeMode: 'dark',
    fontSize: 20,
  })

  expect(settings.update({sendKey: 'mod-enter', reReadNote: false})).toEqual({
    ...DEFAULT_SETTINGS,
    themeMode: 'dark',
    canvasOrientation: 'horizontal',
    fontSize: 20,
    sendKey: 'mod-enter',
    reReadNote: false,
  })
})

it('hands every saved Setting to onSaved after each update', () => {
  const heard: Settings[] = []
  const settings = createSettings(db, saved => heard.push(saved))

  settings.update({themeMode: 'light'})
  settings.update({sendKey: 'mod-enter'})

  expect(heard).toEqual([
    {...DEFAULT_SETTINGS, themeMode: 'light'},
    {...DEFAULT_SETTINGS, themeMode: 'light', sendKey: 'mod-enter'},
  ])
})

it('reads a saved value that no longer fits as the default', () => {
  db.insert(schema.settings)
    .values({key: 'canvasOrientation', value: 'diagonal'})
    .run()

  expect(createSettings(db).read().canvasOrientation).toBe('vertical')
})

it('keeps a Compaction threshold, and clears it back to the Provider’s default', () => {
  const settings = createSettings(db)
  settings.update({claudeCompactionThreshold: 150_000})

  expect(createSettings(db).read().claudeCompactionThreshold).toBe(150_000)

  settings.update({claudeCompactionThreshold: null})

  expect(createSettings(db).read().claudeCompactionThreshold).toBeNull()
})

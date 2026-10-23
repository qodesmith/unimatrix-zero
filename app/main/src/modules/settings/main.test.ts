import {openDatabase, schema} from '#modules/database/main'
import path from 'node:path'
import {beforeEach, expect, it} from 'vitest'

import {createSettings} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

let db: ReturnType<typeof openDatabase>

beforeEach(() => {
  db = openDatabase({file: ':memory:', migrationsFolder})
})

it('starts from the defaults: vertical, capped heights, the meter on', () => {
  expect(createSettings(db).read()).toEqual({
    canvasOrientation: 'vertical',
    limitTurnHeight: true,
    contextSizeMeter: true,
  })
})

it('keeps a change across reopening and leaves the other Settings alone', () => {
  createSettings(db).update({canvasOrientation: 'horizontal'})

  expect(createSettings(db).read()).toEqual({
    canvasOrientation: 'horizontal',
    limitTurnHeight: true,
    contextSizeMeter: true,
  })
})

it('answers an update with every Setting as now saved', () => {
  const settings = createSettings(db)
  settings.update({canvasOrientation: 'horizontal'})

  expect(settings.update({contextSizeMeter: false})).toEqual({
    canvasOrientation: 'horizontal',
    limitTurnHeight: true,
    contextSizeMeter: false,
  })
})

it('reads a saved value that no longer fits as the default', () => {
  db.insert(schema.settings)
    .values({key: 'canvasOrientation', value: 'diagonal'})
    .run()

  expect(createSettings(db).read().canvasOrientation).toBe('vertical')
})

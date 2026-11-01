import {openDatabase, schema} from '#modules/database/main'
import path from 'node:path'
import {beforeEach, expect, it} from 'vitest'

import {createLayout} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

let db: ReturnType<typeof openDatabase>

beforeEach(() => {
  db = openDatabase({file: ':memory:', migrationsFolder})
})

it('keeps a closed sidebar across reopening, and answers with the Layout as now saved', () => {
  expect(createLayout(db).update({sidebarOpen: false})).toEqual({
    sidebarOpen: false,
  })

  expect(createLayout(db).read()).toEqual({sidebarOpen: false})
})

it('reads a saved value that no longer fits as an open sidebar', () => {
  db.insert(schema.layout).values({key: 'sidebarOpen', value: 'closed'}).run()

  expect(createLayout(db).read().sidebarOpen).toBe(true)
})

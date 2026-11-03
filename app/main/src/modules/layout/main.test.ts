import {openDatabase, schema} from '#modules/database/main'
import {DEFAULT_LAYOUT, SIDEBAR_MIN_WIDTH} from '@uz/contract/layout'
import path from 'node:path'
import {beforeEach, expect, it} from 'vitest'

import {createLayout} from './main'

const migrationsFolder = path.resolve(import.meta.dirname, '../../../drizzle')

let db: ReturnType<typeof openDatabase>

beforeEach(() => {
  db = openDatabase({file: ':memory:', migrationsFolder})
})

it('keeps a closed sidebar across reopening, and answers with the Layout as now saved', () => {
  const closed = {...DEFAULT_LAYOUT, sidebarOpen: false}

  expect(createLayout(db).update({sidebarOpen: false})).toEqual(closed)
  expect(createLayout(db).read()).toEqual(closed)
})

it('saves a change over the one saved before it', () => {
  const layout = createLayout(db)
  layout.update({sidebarWidth: SIDEBAR_MIN_WIDTH + 10})

  expect(layout.update({sidebarWidth: SIDEBAR_MIN_WIDTH + 20})).toEqual({
    ...DEFAULT_LAYOUT,
    sidebarWidth: SIDEBAR_MIN_WIDTH + 20,
  })
})

it('reads a saved value that no longer fits as an open sidebar', () => {
  db.insert(schema.layout).values({key: 'sidebarOpen', value: 'closed'}).run()

  expect(createLayout(db).read().sidebarOpen).toBe(true)
})

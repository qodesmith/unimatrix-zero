import {DatabaseSync} from 'node:sqlite'
import {expect, it} from 'vitest'

import runtime from '../electron-runtime.json'

it('runs under the Node that Electron ships', () => {
  expect(process.versions.electron).toBe(runtime.electron)
  expect(process.versions.node).toBe(runtime.node)
})

it('runs with the SQLite that Electron ships', () => {
  const row = new DatabaseSync(':memory:')
    .prepare('select sqlite_version() as version')
    .get() as {version: string}
  expect(row.version).toBe(runtime.sqlite)
})

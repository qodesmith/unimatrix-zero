import type {Database} from './main'

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

import {DatabaseOpenError, openDatabase, schema} from './main'

const shippedMigrations = path.resolve(import.meta.dirname, '../../../drizzle')

let folder: string
let migrationsFolder: string
let file: string
let opened: Database[] = []

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), 'uz-database-'))
  migrationsFolder = path.join(folder, 'drizzle')
  fs.cpSync(shippedMigrations, migrationsFolder, {recursive: true})
  file = path.join(folder, 'data', 'unimatrix.sqlite')
})

afterEach(() => {
  // Windows can't remove a folder while a database in it is still open.
  for (const db of opened) if (db.$client.isOpen) db.$client.close()
  opened = []
  fs.rmSync(folder, {recursive: true, force: true})
})

/** Ships one more migration, as a later app version would. */
function addMigration(name: string, sql: string) {
  fs.mkdirSync(path.join(migrationsFolder, name))
  fs.writeFileSync(path.join(migrationsFolder, name, 'migration.sql'), sql)
}

function open() {
  const db = openDatabase({file, migrationsFolder})
  opened.push(db)

  return db
}

function withTreeAndPrompt() {
  const db = open()
  const tree = db.insert(schema.trees).values({}).returning().get()
  db.insert(schema.prompts).values({treeId: tree.id, text: 'Hello'}).run()
  db.$client.close()
}

function count(table: string) {
  const client = new DatabaseSync(file)
  const row = client.prepare(`SELECT count(*) AS n FROM ${table}`).get()
  client.close()

  return Number(row?.n)
}

function backups() {
  const backupsFolder = path.join(folder, 'data', 'backups')

  return fs.existsSync(backupsFolder) ? fs.readdirSync(backupsFolder) : []
}

describe('opening', () => {
  it('creates every table in memory, with foreign keys on', () => {
    const db = openDatabase({
      file: ':memory:',
      migrationsFolder: shippedMigrations,
    })

    const tables = db.$client
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '\\_%' ESCAPE '\\' AND name != 'sqlite_sequence' ORDER BY name"
      )
      .all()
      .map(row => row.name)

    expect(tables).toEqual([
      'prompts',
      'providers',
      'replies',
      'settings',
      'system_prompts',
      'themes',
      'trees',
    ])
    expect(db.$client.prepare('PRAGMA foreign_keys').get()).toEqual({
      foreign_keys: 1,
    })
  })

  it('opens a file in WAL mode', () => {
    const db = open()

    expect(db.$client.prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'wal',
    })
  })

  it('keeps Trees across a reopen, without a backup when nothing is pending', () => {
    withTreeAndPrompt()

    expect(open().select().from(schema.trees).all()).toHaveLength(1)
    expect(backups()).toEqual([])
  })

  it('gives every row a UUIDv7 id', () => {
    const tree = open().insert(schema.trees).values({}).returning().get()

    expect(tree.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
  })

  it('refuses a database written by a newer app', () => {
    open().$client.close()
    const client = new DatabaseSync(file)
    client
      .prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES (?, ?, ?)'
      )
      .run('future', 0, '29991231000000_future')
    client.close()

    expect(open).toThrow(DatabaseOpenError)
    expect(open).toThrow(/newer version/)
  })

  it('leaves a refused database as it found it', () => {
    open().$client.close()
    const client = new DatabaseSync(file)
    client.exec('PRAGMA journal_mode = DELETE')
    client
      .prepare(
        'INSERT INTO __drizzle_migrations (hash, created_at, name) VALUES (?, ?, ?)'
      )
      .run('future', 0, '29991231000000_future')
    client.close()

    expect(open).toThrow(DatabaseOpenError)

    const after = new DatabaseSync(file)

    expect(after.prepare('PRAGMA journal_mode').get()).toEqual({
      journal_mode: 'delete',
    })
    after.close()
  })
})

describe('migrating', () => {
  it('backs up before applying a pending migration', () => {
    withTreeAndPrompt()
    addMigration(
      '29990101000000_tree_note',
      'ALTER TABLE `trees` ADD `note` text;'
    )

    open().$client.close()

    expect(backups()).toHaveLength(1)

    const backup = new DatabaseSync(
      path.join(folder, 'data', 'backups', backups()[0] ?? '')
    )

    expect(backup.prepare('SELECT count(*) AS n FROM trees').get()).toEqual({
      n: 1,
    })
    backup.close()
  })

  it('keeps only the last three backups', () => {
    withTreeAndPrompt()

    for (const n of [1, 2, 3, 4]) {
      addMigration(
        `2999010100000${n}_tree_note_${n}`,
        `ALTER TABLE \`trees\` ADD \`note_${n}\` text;`
      )
      open().$client.close()
    }

    expect(backups()).toHaveLength(3)
  })

  it('keeps child rows when a migration rebuilds a parent table', () => {
    withTreeAndPrompt()
    addMigration(
      '29990101000000_rebuild_trees',
      [
        'PRAGMA foreign_keys=OFF;',
        "CREATE TABLE `__new_trees` (`id` text PRIMARY KEY, `title` text DEFAULT 'Untitled', `created_at` integer NOT NULL);",
        'INSERT INTO `__new_trees`(`id`, `title`, `created_at`) SELECT `id`, `title`, `created_at` FROM `trees`;',
        'DROP TABLE `trees`;',
        'ALTER TABLE `__new_trees` RENAME TO `trees`;',
        'PRAGMA foreign_keys=ON;',
      ].join('--> statement-breakpoint\n')
    )

    open().$client.close()

    expect(count('prompts')).toBe(1)
  })

  it('restores the backup when the foreign-key check fails', () => {
    withTreeAndPrompt()
    const applied = count('__drizzle_migrations')
    addMigration(
      '29990101000000_orphan',
      "INSERT INTO `prompts` (`id`, `tree_id`, `text`, `created_at`) VALUES ('orphan', 'no-such-tree', 'Lost', 0);"
    )

    expect(open).toThrow(/left as it was/)
    expect(count('prompts')).toBe(1)
    expect(count('__drizzle_migrations')).toBe(applied)
  })
})

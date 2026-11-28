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

function addMigration(name: string, sql: string) {
  fs.mkdirSync(path.join(migrationsFolder, name))
  fs.writeFileSync(path.join(migrationsFolder, name, 'migration.sql'), sql)
}

function open() {
  const db = openDatabase({file, migrationsFolder})
  opened.push(db)

  return db
}

function insertTree(db: Database) {
  const systemPrompt = db
    .insert(schema.systemPrompts)
    .values({hash: 'hash-of-empty', text: ''})
    .returning()
    .get()

  return db
    .insert(schema.trees)
    .values({systemPromptId: systemPrompt.id})
    .returning()
    .get()
}

function withTreeAndPrompt() {
  const db = open()
  const tree = insertTree(db)
  db.insert(schema.prompts).values({treeId: tree.id, text: 'Hello'}).run()
  db.$client.close()
}

function count(table: string) {
  const client = new DatabaseSync(file)
  const row = client.prepare(`SELECT count(*) AS n FROM ${table}`).get()
  client.close()

  return Number(row?.n)
}

function backupColumns(name: string) {
  const backup = new DatabaseSync(path.join(folder, 'data', 'backups', name))

  const columns = backup
    .prepare('SELECT name FROM pragma_table_info(?)')
    .all('trees')
    .map(row => String(row.name))

  backup.close()

  return columns
}

function notesUpTo(last: number) {
  return Array.from({length: last}, (_, index) => `note_${index + 1}`)
}

function backups() {
  const backupsFolder = path.join(folder, 'data', 'backups')

  return fs.existsSync(backupsFolder) ? fs.readdirSync(backupsFolder) : []
}

function openBefore(migration: string) {
  const held = fs
    .readdirSync(migrationsFolder)
    .filter(name => name >= migration)

  for (const name of held) {
    fs.rmSync(path.join(migrationsFolder, name), {recursive: true})
  }

  open().$client.close()

  return {
    client: new DatabaseSync(file),
    migrate() {
      for (const name of held) {
        fs.cpSync(
          path.join(shippedMigrations, name),
          path.join(migrationsFolder, name),
          {recursive: true}
        )
      }

      return open().$client
    },
  }
}

function treeSystemPrompts(client: DatabaseSync) {
  return client
    .prepare(
      'SELECT system_prompts.text FROM trees JOIN system_prompts ON system_prompts.id = trees.system_prompt_id'
    )
    .all()
}

const TREE_SYSTEM_PROMPT_MIGRATION = '20261124125258_plain_the_fallen'

const EMPTY_HASH =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

describe('opening', () => {
  it('turns foreign keys on', () => {
    const db = openDatabase({
      file: ':memory:',
      migrationsFolder: shippedMigrations,
    })

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
    const tree = insertTree(open())

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

    expect(backupColumns(backups()[0] ?? '')).not.toContain('note')
  })

  it('keeps only the last three of eleven backups', () => {
    withTreeAndPrompt()

    for (let n = 1; n <= 11; n++) {
      addMigration(
        `29990101${String(n).padStart(6, '0')}_tree_note_${n}`,
        `ALTER TABLE \`trees\` ADD \`note_${n}\` text;`
      )
      open().$client.close()
    }

    const notesInEach = backups().map(name =>
      backupColumns(name).filter(column => column.startsWith('note_'))
    )

    expect(notesInEach).toHaveLength(3)
    expect(notesInEach).toEqual(
      expect.arrayContaining([notesUpTo(8), notesUpTo(9), notesUpTo(10)])
    )
  })

  it('prunes UUID-named backups from older versions before numbered ones', () => {
    withTreeAndPrompt()
    const backupsFolder = path.join(folder, 'data', 'backups')
    fs.mkdirSync(backupsFolder)

    const legacy = [2, 3].map(
      n => `unimatrix-019a0000-0000-7000-8000-00000000000${n}.sqlite`
    )

    for (const name of [...legacy, 'unimatrix-1.sqlite'])
      fs.writeFileSync(path.join(backupsFolder, name), '')
    addMigration(
      '29990101000000_tree_note',
      'ALTER TABLE `trees` ADD `note` text;'
    )

    open().$client.close()

    expect(backups().toSorted()).toEqual([
      legacy[1],
      'unimatrix-1.sqlite',
      'unimatrix-2.sqlite',
    ])
  })

  it('prunes a zero-padded backup by the name it has on disk', () => {
    withTreeAndPrompt()
    const backupsFolder = path.join(folder, 'data', 'backups')
    fs.mkdirSync(backupsFolder)

    for (const n of ['007', '008', '009'])
      fs.writeFileSync(path.join(backupsFolder, `unimatrix-${n}.sqlite`), '')
    addMigration(
      '29990101000000_tree_note',
      'ALTER TABLE `trees` ADD `note` text;'
    )

    open().$client.close()

    expect(backups().toSorted()).toEqual([
      'unimatrix-008.sqlite',
      'unimatrix-009.sqlite',
      'unimatrix-10.sqlite',
    ])
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

  describe('giving each Tree its own System prompt', () => {
    it('points a Tree at the empty System prompt its Replies ran under, keeping its Turns', () => {
      const {client, migrate} = openBefore(TREE_SYSTEM_PROMPT_MIGRATION)
      client.exec(`
        INSERT INTO system_prompts VALUES ('sp-1', '${EMPTY_HASH}', '', 0);
        INSERT INTO trees (id, created_at) VALUES ('t-1', 0);
        INSERT INTO prompts (id, tree_id, text, created_at) VALUES ('p-1', 't-1', 'Hi', 0);
        INSERT INTO replies (id, tree_id, prompt_id, provider, model, status, content, system_prompt_id, created_at)
          VALUES ('r-1', 't-1', 'p-1', 'claude', 'fake', 'complete', '[]', 'sp-1', 0);
      `)
      client.close()

      const migrated = migrate()

      expect(
        migrated.prepare('SELECT id, system_prompt_id FROM trees').all()
      ).toEqual([{id: 't-1', system_prompt_id: 'sp-1'}])
      expect(count('prompts')).toBe(1)
      expect(count('replies')).toBe(1)
    })

    it('points a Tree with no Reply at a new empty System prompt', () => {
      const {client, migrate} = openBefore(TREE_SYSTEM_PROMPT_MIGRATION)
      client.exec("INSERT INTO trees (id, created_at) VALUES ('t-1', 0);")
      client.close()

      expect(treeSystemPrompts(migrate())).toEqual([{text: ''}])
    })
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

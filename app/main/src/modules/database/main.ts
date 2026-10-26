import type {NodeSQLiteDatabase} from 'drizzle-orm/node-sqlite'

import {readMigrationFiles} from 'drizzle-orm/migrator'
import {drizzle} from 'drizzle-orm/node-sqlite'
import {migrate} from 'drizzle-orm/node-sqlite/migrator'
import {randomUUIDv7} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {DatabaseSync} from 'node:sqlite'

export * as schema from './schema'

export type Database = NodeSQLiteDatabase & {$client: DatabaseSync}

const KEPT_BACKUPS = 3
const MIGRATIONS_TABLE = '__drizzle_migrations'

/** A reason the app can't open its data, in words the user can act on. */
export class DatabaseOpenError extends Error {
  override name = 'DatabaseOpenError'
}

interface OpenOptions {
  file: string
  migrationsFolder: string
}

export function openDatabase({file, migrationsFolder}: OpenOptions): Database {
  const onDisk = file !== ':memory:'

  if (onDisk) fs.mkdirSync(path.dirname(file), {recursive: true, mode: 0o700})

  const client = new DatabaseSync(file)
  client.exec('PRAGMA busy_timeout = 5000')

  const known = new Set(
    readMigrationFiles({migrationsFolder}).map(migration => migration.name)
  )

  const applied = appliedMigrations(client)

  if (applied.some(name => !known.has(name))) {
    client.close()
    throw new DatabaseOpenError(
      'Your data was saved by a newer version of Unimatrix Zero. Update the app to open it.'
    )
  }

  client.exec('PRAGMA journal_mode = WAL')
  const db = drizzle({client})

  if (known.size > applied.length) {
    const backup =
      onDisk && applied.length > 0 ? backUp(client, file) : undefined

    runGuarded(
      client,
      () => migrate(db, {migrationsFolder}),
      () => {
        client.close()

        if (onDisk) restore(file, backup)
      }
    )
  }

  client.exec('PRAGMA foreign_keys = ON')

  return db
}

function appliedMigrations(client: DatabaseSync): string[] {
  const table = client
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(MIGRATIONS_TABLE)

  if (!table) return []

  return client
    .prepare(`SELECT name FROM ${MIGRATIONS_TABLE}`)
    .all()
    .map(row => String(row.name))
}

/**
 * Drizzle wraps each migration in a transaction, where `PRAGMA foreign_keys` is
 * a no-op, so a table rebuild would cascade-delete child rows
 * (drizzle-orm#5782). ADR 0003 says when the guard can go.
 */
function runGuarded(
  client: DatabaseSync,
  run: () => void,
  rollBack: () => void
) {
  client.exec('PRAGMA foreign_keys = OFF')

  try {
    run()
    const violations = client.prepare('PRAGMA foreign_key_check').all()

    if (violations.length > 0) {
      throw new Error(`${violations.length} foreign-key violations`)
    }
  } catch (cause) {
    rollBack()
    throw new DatabaseOpenError(
      'Unimatrix Zero could not update your data, so it was left as it was. Try again, or install the previous version.',
      {cause}
    )
  }
}

function backupsFolder(file: string) {
  return path.join(path.dirname(file), 'backups')
}

function backUp(client: DatabaseSync, file: string): string {
  const folder = backupsFolder(file)
  fs.mkdirSync(folder, {recursive: true, mode: 0o700})

  // UUIDv7 names sort by time.
  const backup = path.join(folder, `unimatrix-${randomUUIDv7()}.sqlite`)
  client.prepare('VACUUM INTO ?').run(backup)

  const stale = fs
    .readdirSync(folder)
    .filter(name => /^unimatrix-.+\.sqlite$/.test(name))
    .toSorted()
    .slice(0, -KEPT_BACKUPS)

  for (const name of stale) fs.rmSync(path.join(folder, name))

  return backup
}

function restore(file: string, backup: string | undefined) {
  for (const suffix of ['', '-wal', '-shm'])
    fs.rmSync(file + suffix, {force: true})

  if (backup) fs.copyFileSync(backup, file)
}

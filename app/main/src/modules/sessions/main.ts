import type {Database} from '#modules/database/main'
import type {
  SessionEntry,
  SessionFile,
  SessionKey,
  SessionStoreRequest,
  SessionStoreValue,
} from '@uz/contract/host'
import type {ProviderId} from '@uz/contract/providers'

import {schema} from '#modules/database/main'
import {SessionEntrySchema} from '@uz/contract/host'
import {and, asc, eq, max} from 'drizzle-orm'

const {sessionEntries, sessionFiles} = schema

function encode(entry: SessionEntry) {
  return Buffer.from(JSON.stringify(entry))
}

function decode(blob: Uint8Array): SessionEntry {
  return SessionEntrySchema.parse(JSON.parse(Buffer.from(blob).toString()))
}

function whereKey(provider: ProviderId, key: SessionKey) {
  return and(
    eq(sessionEntries.provider, provider),
    eq(sessionEntries.projectKey, key.projectKey),
    eq(sessionEntries.sessionId, key.sessionId),
    eq(sessionEntries.subpath, key.subpath ?? '')
  )
}

/**
 * The app's own copy of every Provider session (ADR 0004), as the hosts send
 * it: transcript entries in the order they were written and the files kept
 * beside them, so a session can be restored exactly however old it is.
 */
export function createSessions(db: Database) {
  /** Appends in order, skipping entries whose `uuid` is already kept. */
  function append(
    provider: ProviderId,
    key: SessionKey,
    entries: SessionEntry[]
  ) {
    db.transaction(tx => {
      const last = tx
        .select({position: max(sessionEntries.position)})
        .from(sessionEntries)
        .where(whereKey(provider, key))
        .get()

      let position = (last?.position ?? -1) + 1

      for (const entry of entries) {
        const inserted = tx
          .insert(sessionEntries)
          .values({
            provider,
            projectKey: key.projectKey,
            sessionId: key.sessionId,
            subpath: key.subpath ?? '',
            position,
            uuid: entry.uuid ?? null,
            entry: encode(entry),
          })
          .onConflictDoNothing()
          .returning({id: sessionEntries.id})
          .get()

        if (inserted) position += 1
      }
    })
  }

  function load(provider: ProviderId, key: SessionKey): SessionEntry[] | null {
    const rows = db
      .select({entry: sessionEntries.entry})
      .from(sessionEntries)
      .where(whereKey(provider, key))
      .orderBy(asc(sessionEntries.position))
      .all()

    return rows.length > 0 ? rows.map(row => decode(row.entry)) : null
  }

  function listSubkeys(
    provider: ProviderId,
    projectKey: string,
    sessionId: string
  ) {
    return db
      .selectDistinct({subpath: sessionEntries.subpath})
      .from(sessionEntries)
      .where(
        and(
          eq(sessionEntries.provider, provider),
          eq(sessionEntries.projectKey, projectKey),
          eq(sessionEntries.sessionId, sessionId)
        )
      )
      .all()
      .map(row => row.subpath)
      .filter(subpath => subpath !== '')
  }

  /** Keeps each file, replacing the copy kept before. */
  function saveFiles(
    provider: ProviderId,
    projectKey: string,
    sessionId: string,
    files: SessionFile[]
  ) {
    db.transaction(tx => {
      for (const file of files) {
        const data = Buffer.from(file.base64, 'base64')

        tx.insert(sessionFiles)
          .values({provider, projectKey, sessionId, path: file.path, data})
          .onConflictDoUpdate({
            target: [
              sessionFiles.provider,
              sessionFiles.projectKey,
              sessionFiles.sessionId,
              sessionFiles.path,
            ],
            set: {data},
          })
          .run()
      }
    })
  }

  function loadFiles(
    provider: ProviderId,
    projectKey: string,
    sessionId: string
  ): SessionFile[] {
    return db
      .select({path: sessionFiles.path, data: sessionFiles.data})
      .from(sessionFiles)
      .where(
        and(
          eq(sessionFiles.provider, provider),
          eq(sessionFiles.projectKey, projectKey),
          eq(sessionFiles.sessionId, sessionId)
        )
      )
      .orderBy(asc(sessionFiles.path))
      .all()
      .map(row => ({
        path: row.path,
        base64: Buffer.from(row.data).toString('base64'),
      }))
  }

  /** Answers one request from a Provider host. */
  function handle(
    provider: ProviderId,
    request: SessionStoreRequest
  ): SessionStoreValue {
    const {op} = request

    if (op === 'append') {
      append(provider, request.key, request.entries)

      return null
    }

    if (op === 'load') return load(provider, request.key)

    if (op === 'list-subkeys') {
      return listSubkeys(provider, request.projectKey, request.sessionId)
    }

    if (op === 'save-files') {
      saveFiles(provider, request.projectKey, request.sessionId, request.files)

      return null
    }

    return loadFiles(provider, request.projectKey, request.sessionId)
  }

  return {handle}
}

import type {Database} from '#modules/database/main'
import type {SnapshotPair, VersionedFolder} from './store'
import type {AppEvent} from '@uz/contract/events'
import type {Reply} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {and, eq, isNull, ne} from 'drizzle-orm'
import fs from 'node:fs'
import path from 'node:path'

import {makeTreeFolder} from './folder'
import {createGit} from './git'
import {changedFiles, storeExists, takeSnapshot} from './store'

export {withFilesSection} from './section'

const {prompts, replies} = schema

export interface TreeFilesDeps {
  db: Database
  userData: string
  publish: (event: AppEvent) => void
  /** A Snapshot that couldn't be taken or read; the Reply itself is unharmed. */
  onFailure: (error: Error) => void
}

/**
 * Each Reply's nearest Snapshot above it. A Reply has none of its own while
 * the Tree has no files yet, or until its Snapshot is taken.
 */
function parentSnapshots(rows: SnapshotRow[]) {
  const byId = new Map(rows.map(row => [row.replyId, row]))

  return (replyId: string): string | null => {
    let above = byId.get(byId.get(replyId)?.parentReplyId ?? '')

    while (above?.snapshotCommit === null) {
      above = byId.get(above.parentReplyId ?? '')
    }

    return above?.snapshotCommit ?? null
  }
}

function snapshotRows(db: Database, treeId: string) {
  return db
    .select({
      replyId: replies.id,
      parentReplyId: prompts.parentReplyId,
      snapshotCommit: replies.snapshotCommit,
    })
    .from(replies)
    .innerJoin(prompts, eq(prompts.id, replies.promptId))
    .where(eq(replies.treeId, treeId))
    .all()
}

type SnapshotRow = ReturnType<typeof snapshotRows>[number]

export type TreeFiles = ReturnType<typeof createTreeFiles>

/**
 * The Tree's files: its own folder in `userData`, where the AI works, and a
 * hidden git store beside it that keeps a Snapshot for every Reply. The store
 * is outside that folder and is never named to the AI.
 */
export function createTreeFiles({
  db,
  userData,
  publish,
  onFailure,
}: TreeFilesDeps) {
  const git = createGit(process.env)
  /** By Tree, the last Snapshot asked for. */
  const snapshotting = new Map<string, Promise<void>>()

  function storeOf(treeId: string) {
    return path.join(userData, 'tree-stores', `${treeId}.git`)
  }

  /** The one Working copy a Tree has: its own folder. */
  function workingCopyOf(treeId: string): VersionedFolder {
    const store = storeOf(treeId)

    return {
      store,
      folder: makeTreeFolder(userData, treeId),
      index: path.join(store, 'uz-indexes', 'tree-folder'),
    }
  }

  /** A Retry already running writes its own once it finishes. */
  function save(
    replyId: string,
    saved: Pick<typeof replies.$inferInsert, 'snapshotCommit' | 'noSnapshot'>
  ) {
    return db
      .update(replies)
      .set(saved)
      .where(and(eq(replies.id, replyId), ne(replies.status, 'streaming')))
      .returning({id: replies.id})
      .get()
  }

  async function snapshot(treeId: string, replyId: string) {
    const copy = workingCopyOf(treeId)

    // Until the AI first writes a file, the Tree has an empty folder and
    // nothing else.
    if (!storeExists(copy.store) && fs.readdirSync(copy.folder).length === 0) {
      save(replyId, {noSnapshot: 'no-files'})

      return
    }

    const parent = parentSnapshots(snapshotRows(db, treeId))(replyId)
    const commit = await takeSnapshot(git, copy, {replyId, parent})
    const saved = save(replyId, {snapshotCommit: commit, noSnapshot: null})

    if (!saved || commit === parent) return

    const changed = await changedFiles(git, copy.store, [
      {replyId, from: parent, to: commit},
    ])

    const files = changed.get(replyId)

    if (files) publish({type: 'FILES_CHANGED', treeId, replyId, files})
  }

  /** A Snapshot that fails never fails the Reply or the Turns it belongs to. */
  async function snapshotReporting(treeId: string, replyId: string) {
    try {
      await snapshot(treeId, replyId)
    } catch (error) {
      db.update(replies)
        .set({noSnapshot: 'failed'})
        .where(
          and(
            eq(replies.id, replyId),
            ne(replies.status, 'streaming'),
            isNull(replies.snapshotCommit)
          )
        )
        .run()

      onFailure(error instanceof Error ? error : new Error(String(error)))
    }
  }

  /**
   * A finished Reply whose Snapshot the app quit before taking, or failed to
   * take.
   */
  function missesSnapshot(replyId: string) {
    const row = db
      .select({
        status: replies.status,
        snapshotCommit: replies.snapshotCommit,
        noSnapshot: replies.noSnapshot,
      })
      .from(replies)
      .where(eq(replies.id, replyId))
      .get()

    return (
      row !== undefined &&
      row.status !== 'streaming' &&
      row.snapshotCommit === null &&
      row.noSnapshot !== 'no-files'
    )
  }

  /** Snapshots of a Tree are taken one at a time, in the order asked. */
  async function queue(treeId: string, work: () => Promise<void>) {
    const before = snapshotting.get(treeId) ?? Promise.resolve()

    const taken = before.then(work).finally(() => {
      if (snapshotting.get(treeId) === taken) snapshotting.delete(treeId)
    })

    snapshotting.set(treeId, taken)

    return taken
  }

  return {
    /** Made empty if missing: a vendor program's `cwd` has to exist. */
    folderFor: (treeId: string) => makeTreeFolder(userData, treeId),

    /** Takes the Reply's Snapshot, however it ended. Never rejects. */
    async replyFinished({treeId, replyId}: {treeId: string; replyId: string}) {
      return queue(treeId, async () => snapshotReporting(treeId, replyId))
    },

    /**
     * Settles once no Snapshot is being taken of the Tree's files, the one of
     * the Reply a new Reply follows included when it has none yet; null when
     * nothing is to wait for. Never rejects.
     */
    snapshotsBefore: (
      treeId: string,
      parentReplyId: string | null
    ): Promise<void> | null => {
      if (parentReplyId !== null && missesSnapshot(parentReplyId)) {
        return queue(treeId, async () => {
          if (missesSnapshot(parentReplyId)) {
            await snapshotReporting(treeId, parentReplyId)
          }
        })
      }

      return snapshotting.get(treeId) ?? null
    },

    async withChangedFiles(treeId: string, listed: Reply[]): Promise<Reply[]> {
      await snapshotting.get(treeId)

      const store = storeOf(treeId)

      if (!storeExists(store)) return listed

      const rows = snapshotRows(db, treeId)
      const parentOf = parentSnapshots(rows)

      const pairs = rows.flatMap(
        ({replyId, snapshotCommit}): SnapshotPair[] => {
          const from = parentOf(replyId)

          return snapshotCommit === null || snapshotCommit === from
            ? []
            : [{replyId, from, to: snapshotCommit}]
        }
      )

      try {
        const changed = await changedFiles(git, store, pairs)

        return listed.map(reply => ({
          ...reply,
          files: changed.get(reply.id) ?? [],
        }))
      } catch (error) {
        onFailure(error instanceof Error ? error : new Error(String(error)))

        return listed
      }
    },
  }
}

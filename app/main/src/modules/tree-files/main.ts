import type {Database} from '#modules/database/main'
import type {Git} from './git'
import type {SnapshotPair, WorkingCopy} from './store'
import type {AppEvent} from '@uz/contract/events'
import type {Reply} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {and, eq, ne} from 'drizzle-orm'
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
  git?: Git
}

interface SnapshotRow {
  replyId: string
  parentReplyId: string | null
  snapshotCommit: string | null
}

/**
 * Each Reply's nearest Snapshot above it. A Reply has none of its own while
 * the Tree has no files yet, or when the app quit before taking it.
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

function snapshotRows(db: Database, treeId: string): SnapshotRow[] {
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
  git = createGit(process.env),
}: TreeFilesDeps) {
  /** By Tree: its Snapshots are taken one at a time, in the order asked. */
  const snapshotting = new Map<string, Promise<void>>()

  function storeOf(treeId: string) {
    return path.join(userData, 'tree-stores', `${treeId}.git`)
  }

  /** One Thread until Branches get Working copies of their own (#88). */
  function workingCopyOf(treeId: string): WorkingCopy {
    const store = storeOf(treeId)

    return {
      store,
      folder: makeTreeFolder(userData, treeId),
      index: path.join(store, 'uz-indexes', 'tree-folder'),
    }
  }

  async function snapshot(treeId: string, replyId: string) {
    const copy = workingCopyOf(treeId)

    // Until the AI first writes a file, the Tree has an empty folder and
    // nothing else.
    if (!storeExists(copy.store) && fs.readdirSync(copy.folder).length === 0) {
      return
    }

    const parent = parentSnapshots(snapshotRows(db, treeId))(replyId)
    const commit = await takeSnapshot(git, copy, {replyId, parent})

    // A Retry already running writes its own once it finishes.
    const saved = db
      .update(replies)
      .set({snapshotCommit: commit})
      .where(and(eq(replies.id, replyId), ne(replies.status, 'streaming')))
      .returning({id: replies.id})
      .get()

    if (!saved || commit === parent) return

    const changed = await changedFiles(git, copy.store, [
      {replyId, from: parent, to: commit},
    ])

    const files = changed.get(replyId)

    if (files) publish({type: 'FILES_CHANGED', treeId, replyId, files})
  }

  /** A Snapshot that fails never fails the Reply or the Turns it belongs to. */
  async function reporting<T>(work: () => Promise<T>, otherwise: T) {
    try {
      return await work()
    } catch (error) {
      onFailure(error instanceof Error ? error : new Error(String(error)))

      return otherwise
    }
  }

  return {
    /** Made empty if missing: a vendor program's `cwd` has to exist. */
    folderFor: (treeId: string) => makeTreeFolder(userData, treeId),

    /** Takes the Reply's Snapshot, however it ended. Never rejects. */
    async replyFinished({treeId, replyId}: {treeId: string; replyId: string}) {
      const before = snapshotting.get(treeId) ?? Promise.resolve()

      const taken = reporting(async () => {
        await before
        await snapshot(treeId, replyId)
      }, undefined).finally(() => {
        if (snapshotting.get(treeId) === taken) snapshotting.delete(treeId)
      })

      snapshotting.set(treeId, taken)

      return taken
    },

    /**
     * Settles once the Tree's files are no longer being read for a Snapshot;
     * null when none is being taken.
     */
    snapshotting: (treeId: string): Promise<void> | null =>
      snapshotting.get(treeId) ?? null,

    /** The Tree's Replies, each with the files it changed. */
    async withChangedFiles(treeId: string, listed: Reply[]): Promise<Reply[]> {
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

      return reporting(async () => {
        const changed = await changedFiles(git, store, pairs)

        return listed.map(reply => ({
          ...reply,
          files: changed.get(reply.id) ?? [],
        }))
      }, listed)
    },
  }
}

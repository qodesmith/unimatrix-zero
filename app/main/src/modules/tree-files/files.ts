import type {Database} from '#modules/database/main'
import type {Desktop} from './desktop'
import type {Git, GitBlobs} from './git'
import type {ListedFile} from './listing'
import type {OpenWith, Openable} from './opening'
import type {
  TreeFile,
  TreeFileDetails,
  TreeFileId,
} from '@uz/contract/tree-files'

import {schema} from '#modules/database/main'
import {and, desc, eq} from 'drizzle-orm'
import {createHash, randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {listSnapshot} from './listing'
import {createCopies, hasExecuteBit, inTreeFolder} from './location'
import {openWith, reveal} from './opening'
import {SAMPLE_BYTES, isLinkMode, mediaTypeOf, previewOf} from './preview'

const {replies} = schema

export interface FilesContext {
  db: Database
  git: Git
  blobs: () => GitBlobs
  storeOf: (treeId: string) => string
  folderFor: (treeId: string) => string
  /** Settles once the Tree has no Snapshot in progress. */
  settled: (treeId: string) => Promise<void>
  /** Above the nearest Reply with a Snapshot, or null. */
  snapshotAbove: (treeId: string, replyId: string) => string | null
  tempDir: string
  desktop: Desktop
}

interface Known extends ListedFile {
  id: TreeFileId
  treeId: string
  replyId: string
}

function idOf(replyId: string, filePath: string): TreeFileId {
  return createHash('sha256')
    .update(`${replyId}\0${filePath}`)
    .digest('hex')
    .slice(0, 32)
}

function asTreeFile({id, path: filePath, size, change}: Known): TreeFile {
  return {id, path: filePath, size, change}
}

export function createSnapshotFiles(context: FilesContext) {
  const {db, git} = context
  const known = new Map<TreeFileId, Known>()
  const copies = createCopies(context.tempDir, context.blobs)

  function replyOf(treeId: string, replyId: string) {
    return db
      .select({status: replies.status, snapshotCommit: replies.snapshotCommit})
      .from(replies)
      .where(and(eq(replies.id, replyId), eq(replies.treeId, treeId)))
      .get()
  }

  /** One folder holds the Tree's files: the newest Reply's, once it ends. */
  function replyOnDisk(treeId: string, replyId: string) {
    const newest = db
      .select({id: replies.id, status: replies.status})
      .from(replies)
      .where(eq(replies.treeId, treeId))
      .orderBy(desc(replies.createdAt), desc(replies.id))
      .limit(1)
      .get()

    return newest?.id === replyId && newest.status !== 'streaming'
  }

  async function snapshotFiles(
    treeId: string,
    replyId: string,
    own: string | null
  ) {
    const above = context.snapshotAbove(treeId, replyId)
    const commit = own ?? above

    if (commit === null) return []

    return listSnapshot(git, context.storeOf(treeId), {
      commit,
      parent: above,
      own: own !== null,
    })
  }

  /** Null for an id never listed, or one whose Reply is gone. */
  function knownFile(id: TreeFileId) {
    const file = known.get(id)
    const reply = file && replyOf(file.treeId, file.replyId)

    if (!file || !reply) return null

    return {
      file,
      onDisk:
        file.change !== 'deleted' && replyOnDisk(file.treeId, file.replyId),
    }
  }

  async function sampleOf(file: Known) {
    return isLinkMode(file.mode)
      ? Buffer.alloc(0)
      : context
          .blobs()
          .start(context.storeOf(file.treeId), file.blob, SAMPLE_BYTES)
  }

  async function kindOf(file: Known) {
    return previewOf({
      name: file.path,
      mode: file.mode,
      size: file.size,
      sample: await sampleOf(file),
    })
  }

  async function copyOf(file: Known) {
    return copies.copyOf(context.storeOf(file.treeId), file.blob, file.path)
  }

  async function openable(id: TreeFileId): Promise<Openable | null> {
    const found = knownFile(id)

    if (!found) return null

    const {file, onDisk} = found

    return {
      ...(await kindOf(file)),
      path: file.path,
      onDisk,
      locate: async () => {
        if (!onDisk) return {file: await copyOf(file), executable: false}

        const {file: real, stat} = inTreeFolder(
          context.folderFor(file.treeId),
          file.path
        )

        return {file: real, executable: hasExecuteBit(stat)}
      },
    }
  }

  /** A link is written as a file holding the path it points to. */
  async function writeSnapshot(treeId: string, commit: string, target: string) {
    const indexes = path.join(context.tempDir, 'indexes')
    fs.mkdirSync(indexes, {recursive: true, mode: 0o700})

    const checkout = {folder: target, index: path.join(indexes, randomUUID())}
    const store = context.storeOf(treeId)

    try {
      await git({store, checkout}, ['read-tree', commit])
      await git({store, checkout}, [
        '-c',
        'core.symlinks=false',
        'checkout-index',
        '--all',
      ])
    } finally {
      fs.rmSync(checkout.index, {force: true})
    }
  }

  function modifiedOf(file: Known) {
    try {
      const {stat} = inTreeFolder(context.folderFor(file.treeId), file.path)

      return stat.mtime.toISOString()
    } catch {
      return null
    }
  }

  return {
    async describeFile(id: TreeFileId): Promise<TreeFileDetails | null> {
      const found = knownFile(id)

      if (!found) return null

      const {file, onDisk} = found
      const kind = await kindOf(file)

      return {
        ...asTreeFile(file),
        ...kind,
        onDisk,
        editor: onDisk && !kind.link ? context.desktop.editor() : null,
        quickLook: context.desktop.platform === 'darwin' && !kind.link,
        modified: onDisk ? modifiedOf(file) : null,
      }
    },

    /** For `uzfile://`: previews read the Snapshot, never the Tree's folder. */
    async servedFile(id: TreeFileId) {
      const file = knownFile(id)?.file

      if (!file) return null

      const {preview, tooLarge} = await kindOf(file)

      return {
        path: await copyOf(file),
        preview,
        mediaType: mediaTypeOf(file.path),
        tooLarge,
      }
    },

    /** False for an id never listed; rejects with why it won't open. */
    async openFile(id: TreeFileId, how: OpenWith) {
      const found = await openable(id)

      if (found) await openWith(context.desktop, found, how)

      return found !== null
    },

    async revealFile(id: TreeFileId) {
      const found = await openable(id)

      if (found) await reveal(context.desktop, found)

      return found !== null
    },

    /** Null for an id never listed. */
    async saveFileCopy(id: TreeFileId) {
      const file = knownFile(id)?.file

      if (!file) return null

      const target = await context.desktop.pickSaveFile(
        path.posix.basename(file.path)
      )

      if (target === null) return {saved: false}

      await context
        .blobs()
        .write(context.storeOf(file.treeId), file.blob, target)

      return {saved: true}
    },

    /** Null when the Tree has no such Reply. */
    async saveFilesCopy(treeId: string, replyId: string) {
      const reply = replyOf(treeId, replyId)

      if (!reply) return null

      const commit =
        reply.snapshotCommit ?? context.snapshotAbove(treeId, replyId)

      if (commit === null) throw new Error('This Turn has no files to save.')

      const target = await context.desktop.pickFolder()

      if (target === null) return {saved: false}

      if (fs.readdirSync(target).some(name => name !== '.DS_Store')) {
        throw new Error(
          'That folder already has files in it. Pick an empty folder, or make a new one.'
        )
      }

      await writeSnapshot(treeId, commit, target)

      return {saved: true}
    },

    /** Null for an id never listed. */
    async thumbnail(id: TreeFileId) {
      const found = await openable(id)

      if (!found) return null

      if (context.desktop.platform !== 'darwin' || found.link) {
        return {dataUrl: null}
      }

      try {
        const {file} = await found.locate()

        return {dataUrl: await context.desktop.thumbnail(file)}
      } catch {
        return {dataUrl: null}
      }
    },

    /** Null when the Tree has no such Reply. */
    async listFiles(treeId: string, replyId: string) {
      await context.settled(treeId)

      const reply = replyOf(treeId, replyId)

      if (!reply) return null

      const listed = await snapshotFiles(treeId, replyId, reply.snapshotCommit)

      const files = listed.map(file => {
        const entry = {...file, id: idOf(replyId, file.path), treeId, replyId}
        known.set(entry.id, entry)

        return asTreeFile(entry)
      })

      return {files, onDisk: replyOnDisk(treeId, replyId)}
    },
  }
}

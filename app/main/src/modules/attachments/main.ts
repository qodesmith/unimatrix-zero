import type {Database} from '#modules/database/main'
import type {FileMediaType} from './media-type'
import type {Attachment} from '@uz/contract/attachments'
import type {Command} from '@uz/contract/commands'

import {schema} from '#modules/database/main'
import {
  ATTACHMENT_SIZE_LIMIT,
  FOLDER_MEDIA_TYPE,
  INLINE_IMAGE_SIZE_LIMIT,
  attachmentKind,
} from '@uz/contract/attachments'
import {eq} from 'drizzle-orm'
import {createHash} from 'node:crypto'
import path from 'node:path'

import {sniffMediaType} from './media-type'
import {safeName} from './names'
import {
  isFolder,
  keepOriginal,
  keepShrunk,
  originalPath,
  readDropped,
} from './originals'
import {toAttachment} from './prompts'

export {hostAttachments} from './host'

export {attachToPrompt, attachmentsOf, refuseTooManyImages} from './prompts'

type AttachmentAdd = Extract<Command, {type: 'attachment.add'}>

export type AttachmentFile = AttachmentAdd['file']

export interface AttachmentsDeps {
  db: Database
  /** `userData/attachments/`, where the copies are kept. */
  dir: string
  /** Null for an id the dropped-files module never gave out. */
  droppedPath: (fileId: string) => string | null
}

export type Attachments = ReturnType<typeof createAttachments>

const LIMIT_MIB = ATTACHMENT_SIZE_LIMIT / 1024 / 1024

function refuseUnfit(bytes: Uint8Array, label: string) {
  if (bytes.byteLength === 0) {
    throw new Error(`There’s nothing in ${label} to attach.`)
  }

  if (bytes.byteLength > ATTACHMENT_SIZE_LIMIT) {
    throw new Error(
      `Unimatrix Zero attaches files up to ${LIMIT_MIB} MiB; ${label} is larger.`
    )
  }
}

function sha256Of(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Null leaves the original to go as it is: the window's copy is kept only for
 * an image, and only as a PNG or JPEG small enough to go inline.
 */
function shrunkToKeep(mediaType: FileMediaType, bytes: Uint8Array | undefined) {
  if (bytes === undefined || attachmentKind(mediaType) !== 'image') return null

  const shrunkMediaType = sniffMediaType(bytes)

  if (shrunkMediaType !== 'image/png' && shrunkMediaType !== 'image/jpeg') {
    return null
  }

  return bytes.byteLength > INLINE_IMAGE_SIZE_LIMIT
    ? null
    : {sha256: sha256Of(bytes), mediaType: shrunkMediaType, bytes}
}

export function createAttachments({db, dir, droppedPath}: AttachmentsDeps) {
  function droppedPathOf(fileId: string) {
    const filePath = droppedPath(fileId)

    if (filePath === null) {
      throw new Error(
        'That file can’t be attached any more. Drop or pick it again.'
      )
    }

    return filePath
  }

  /** A folder is its path alone: nothing of it is read or copied. */
  function addFolder(dropped: string) {
    const folderPath = path.resolve(dropped)

    return db
      .insert(schema.attachments)
      .values({
        sha256: null,
        name: safeName(folderPath, FOLDER_MEDIA_TYPE),
        mediaType: FOLDER_MEDIA_TYPE,
        size: 0,
        folderPath,
      })
      .returning()
      .get()
  }

  async function addFile(
    file: {name: string; bytes: Uint8Array},
    shrunkBytes: Uint8Array | undefined
  ) {
    refuseUnfit(file.bytes, file.name.trim() || 'the pasted file')

    const mediaType = sniffMediaType(file.bytes)
    const name = safeName(file.name, mediaType)
    const sha256 = sha256Of(file.bytes)
    await keepOriginal(dir, {sha256, name}, file.bytes)

    const shrunk = shrunkToKeep(mediaType, shrunkBytes)

    if (shrunk) await keepShrunk(dir, shrunk, shrunk.bytes)

    return db
      .insert(schema.attachments)
      .values({
        sha256,
        name,
        mediaType,
        size: file.bytes.byteLength,
        shrunkSha256: shrunk?.sha256,
        shrunkMediaType: shrunk?.mediaType,
        shrunkSize: shrunk?.bytes.byteLength,
      })
      .returning()
      .get()
  }

  return {
    /**
     * A file's bytes are kept once per content, under each name they were
     * added by; each add gets its own id. `shrunk` is the window's smaller
     * copy of a large image.
     */
    async add(file: AttachmentFile, shrunk?: Uint8Array): Promise<Attachment> {
      if (file.type === 'pasted') {
        return toAttachment(await addFile(file, shrunk))
      }

      const dropped = droppedPathOf(file.fileId)

      if (await isFolder(dropped)) return toAttachment(addFolder(dropped))

      const read = await readDropped(dropped, ATTACHMENT_SIZE_LIMIT)

      return toAttachment(await addFile(read, shrunk))
    },

    /**
     * For serving by id; null for an id main never gave out, and for a folder,
     * which has no copy.
     */
    original(id: string) {
      const row = db
        .select()
        .from(schema.attachments)
        .where(eq(schema.attachments.id, id))
        .get()

      return row && row.sha256 !== null
        ? {
            path: originalPath(dir, row.sha256, row.name),
            mediaType: row.mediaType,
          }
        : null
    },
  }
}

import type {Database} from '#modules/database/main'
import type {Extractor} from './extractions'
import type {FileMediaType} from './media-type'
import type {Attachment} from '@uz/contract/attachments'
import type {Command} from '@uz/contract/commands'
import type {Prompt} from '@uz/contract/turns'

import {schema} from '#modules/database/main'
import {
  ATTACHMENT_SIZE_LIMIT,
  FOLDER_MEDIA_TYPE,
  INLINE_IMAGE_SIZE_LIMIT,
  attachmentKind,
} from '@uz/contract/attachments'
import {formatSize} from '@uz/contract/sizes'
import {eq, inArray} from 'drizzle-orm'
import {createHash} from 'node:crypto'
import path from 'node:path'

import {extractionFor} from './extractions'
import {sniffMediaType} from './media-type'
import {safeName} from './names'
import {
  canRead,
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
  dir: string
  droppedPath: (fileId: string) => string | null
  extract: Extractor
}

export type Attachments = ReturnType<typeof createAttachments>

function refuseUnfit(bytes: Uint8Array, label: string) {
  if (bytes.byteLength === 0) {
    throw new Error(`There’s nothing in ${label} to attach.`)
  }

  if (bytes.byteLength > ATTACHMENT_SIZE_LIMIT) {
    throw new Error(
      `Unimatrix Zero attaches files up to ${formatSize(ATTACHMENT_SIZE_LIMIT)}; ${label} is larger.`
    )
  }
}

function sha256Of(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

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

export function createAttachments({
  db,
  dir,
  droppedPath,
  extract,
}: AttachmentsDeps) {
  function droppedPathOf(fileId: string) {
    const filePath = droppedPath(fileId)

    if (filePath === null) {
      throw new Error(
        'That file can’t be attached any more. Drop or pick it again.'
      )
    }

    return filePath
  }

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

    const extraction = await extractionFor(
      {db, dir, extract},
      {sha256, bytes: file.bytes}
    )

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
        extraction,
      })
      .returning()
      .get()
  }

  async function missingIds(ids: string[]) {
    if (ids.length === 0) return new Set<string>()

    const rows = db
      .select({
        id: schema.attachments.id,
        sha256: schema.attachments.sha256,
        name: schema.attachments.name,
      })
      .from(schema.attachments)
      .where(inArray(schema.attachments.id, ids))
      .all()

    const missing = await Promise.all(
      rows.map(async ({id, sha256, name}) =>
        sha256 !== null && !(await canRead(originalPath(dir, sha256, name)))
          ? [id]
          : []
      )
    )

    return new Set(missing.flat())
  }

  return {
    async add(file: AttachmentFile, shrunk?: Uint8Array): Promise<Attachment> {
      if (file.type === 'pasted') {
        return toAttachment(await addFile(file, shrunk))
      }

      const dropped = droppedPathOf(file.fileId)

      if (await isFolder(dropped)) return toAttachment(addFolder(dropped))

      const read = await readDropped(dropped, ATTACHMENT_SIZE_LIMIT)

      return toAttachment(await addFile(read, shrunk))
    },

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

    async withMissingCopies(prompts: Prompt[]): Promise<Prompt[]> {
      const missing = await missingIds([
        ...new Set(
          prompts.flatMap(({attachments}) => attachments.map(({id}) => id))
        ),
      ])

      return prompts.map(prompt => ({
        ...prompt,
        attachments: prompt.attachments.map(attachment =>
          missing.has(attachment.id)
            ? {...attachment, missing: true}
            : attachment
        ),
      }))
    },
  }
}

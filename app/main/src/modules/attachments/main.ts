import type {Database} from '#modules/database/main'
import type {Attachment, AttachmentMediaType} from '@uz/contract/attachments'
import type {Command} from '@uz/contract/commands'

import {schema} from '#modules/database/main'
import {ATTACHMENT_SIZE_LIMIT} from '@uz/contract/attachments'
import {eq} from 'drizzle-orm'
import {createHash} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {sniffMediaType} from './media-type'
import {keepOriginal, originalPath, readDropped} from './originals'

export {attachToPrompt, attachmentsOf, originalsOf} from './prompts'

export type AttachmentFile = Extract<Command, {type: 'attachment.add'}>['file']

export interface AttachmentsDeps {
  db: Database
  /** `userData/attachments/`, where the originals are kept. */
  dir: string
  /** Null for an id the dropped-files module never gave out. */
  droppedPath: (fileId: string) => string | null
}

export type Attachments = ReturnType<typeof createAttachments>

const LIMIT_MB = ATTACHMENT_SIZE_LIMIT / 1024 / 1024

/** For a pasted file, which may come with no name. */
const FALLBACK_NAMES = {
  'image/png': 'Pasted image.png',
  'image/jpeg': 'Pasted image.jpg',
  'image/gif': 'Pasted image.gif',
  'image/webp': 'Pasted image.webp',
  'application/pdf': 'Pasted PDF.pdf',
  'text/plain': 'Pasted text.txt',
} satisfies Record<AttachmentMediaType, string>

/** Where a Provider host keeps what it converts; main never writes there. */
export function conversionDir(dir: string) {
  return path.join(dir, 'conversions')
}

function refuseUnfit(bytes: Uint8Array, label: string): AttachmentMediaType {
  if (bytes.byteLength === 0) {
    throw new Error(`There’s nothing in ${label} to attach.`)
  }

  if (bytes.byteLength > ATTACHMENT_SIZE_LIMIT) {
    throw new Error(
      `Unimatrix Zero attaches files up to ${LIMIT_MB} MB; ${label} is larger.`
    )
  }

  const mediaType = sniffMediaType(bytes)

  if (!mediaType) {
    throw new Error(
      `Unimatrix Zero attaches images, PDFs and text files; ${label} is none of these.`
    )
  }

  return mediaType
}

function toAttachment(row: typeof schema.attachments.$inferSelect): Attachment {
  return {
    id: row.id,
    name: row.name,
    mediaType: row.mediaType,
    size: row.size,
  }
}

export function createAttachments({db, dir, droppedPath}: AttachmentsDeps) {
  fs.mkdirSync(conversionDir(dir), {recursive: true, mode: 0o700})

  async function bytesOf(file: AttachmentFile) {
    if (file.type === 'pasted') {
      return {name: path.basename(file.name.trim()).trim(), bytes: file.bytes}
    }

    const filePath = droppedPath(file.fileId)

    if (filePath === null) {
      throw new Error(
        'That file can’t be attached any more. Drop or pick it again.'
      )
    }

    return readDropped(filePath, ATTACHMENT_SIZE_LIMIT)
  }

  return {
    /** The original is kept once per content; each add gets its own id. */
    async add(file: AttachmentFile): Promise<Attachment> {
      const {name, bytes} = await bytesOf(file)
      const mediaType = refuseUnfit(bytes, name || 'the pasted file')
      const sha256 = createHash('sha256').update(bytes).digest('hex')
      await keepOriginal(dir, sha256, bytes)

      const row = db
        .insert(schema.attachments)
        .values({
          sha256,
          name: name || FALLBACK_NAMES[mediaType],
          mediaType,
          size: bytes.byteLength,
        })
        .returning()
        .get()

      return toAttachment(row)
    },

    /** For serving by id; null for an id main never gave out. */
    original(id: string) {
      const row = db
        .select()
        .from(schema.attachments)
        .where(eq(schema.attachments.id, id))
        .get()

      return row
        ? {path: originalPath(dir, row.sha256), mediaType: row.mediaType}
        : null
    },
  }
}

import type {Database} from '#modules/database/main'
import type {Attachment} from '@uz/contract/attachments'

import {schema} from '#modules/database/main'
import {
  INLINE_IMAGES_PER_PROMPT_LIMIT,
  inlineImagesSize,
} from '@uz/contract/attachments'
import {formatSize} from '@uz/contract/sizes'
import {asc, eq, getTableColumns, inArray} from 'drizzle-orm'

const {attachments, promptAttachments} = schema

export type AttachmentRow = typeof attachments.$inferSelect

type Reader = Pick<Database, 'select'>

type Writer = Pick<Database, 'select' | 'insert'>

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    name: row.name,
    mediaType: row.mediaType,
    size: row.size,
    shrunkSize: row.shrunkSize,
    folderPath: row.folderPath,
  }
}

/** Call before the Prompt is saved; `attachToPrompt` refuses unknown ids. */
export function refuseTooManyImages(db: Reader, ids: string[]) {
  if (ids.length === 0) return

  const rows = db
    .select()
    .from(attachments)
    .where(inArray(attachments.id, ids))
    .all()

  const byId = new Map(rows.map(row => [row.id, row]))
  const sent = ids.flatMap(id => byId.get(id) ?? [])

  if (inlineImagesSize(sent) > INLINE_IMAGES_PER_PROMPT_LIMIT) {
    throw new Error(
      `A Prompt sends up to ${formatSize(INLINE_IMAGES_PER_PROMPT_LIMIT)} of images; these come to more. Remove some and send again.`
    )
  }
}

/** Call in the transaction that saves the Prompt. */
export function attachToPrompt(tx: Writer, promptId: string, ids: string[]) {
  if (ids.length === 0) return

  const known = tx
    .select({id: attachments.id})
    .from(attachments)
    .where(inArray(attachments.id, ids))
    .all()

  if (known.length < new Set(ids).size) {
    throw new Error('An attachment is no longer available. Attach it again.')
  }

  tx.insert(promptAttachments)
    .values(
      ids.map((attachmentId, position) => ({promptId, attachmentId, position}))
    )
    .run()
}

/** In order; a Prompt with none has no entry. */
export function rowsOf(
  db: Reader,
  promptIds: string[]
): Map<string, AttachmentRow[]> {
  const rows = db
    .select({
      promptId: promptAttachments.promptId,
      attachment: getTableColumns(attachments),
    })
    .from(promptAttachments)
    .innerJoin(attachments, eq(attachments.id, promptAttachments.attachmentId))
    .where(inArray(promptAttachments.promptId, promptIds))
    .orderBy(asc(promptAttachments.position))
    .all()

  const byPrompt = new Map<string, AttachmentRow[]>()

  for (const {promptId, attachment} of rows) {
    byPrompt.set(promptId, [...(byPrompt.get(promptId) ?? []), attachment])
  }

  return byPrompt
}

/** In order; a Prompt with none has no entry. */
export function attachmentsOf(
  db: Reader,
  promptIds: string[]
): Map<string, Attachment[]> {
  return new Map(
    [...rowsOf(db, promptIds)].map(([promptId, rows]) => [
      promptId,
      rows.map(toAttachment),
    ])
  )
}

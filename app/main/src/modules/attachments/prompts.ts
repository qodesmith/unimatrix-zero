import type {Database} from '#modules/database/main'
import type {Attachment, HostAttachment} from '@uz/contract/attachments'

import {schema} from '#modules/database/main'
import {asc, eq, inArray} from 'drizzle-orm'

import {originalPath} from './originals'

const {attachments, promptAttachments} = schema

type Reader = Pick<Database, 'select'>

type Writer = Pick<Database, 'select' | 'insert'>

/** In the transaction that saves the Prompt; refuses an id main never gave out. */
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

/** Each Prompt's attachments, in order; a Prompt with none has no entry. */
export function attachmentsOf(
  db: Reader,
  promptIds: string[]
): Map<string, Attachment[]> {
  const rows = db
    .select({
      promptId: promptAttachments.promptId,
      id: attachments.id,
      name: attachments.name,
      mediaType: attachments.mediaType,
      size: attachments.size,
    })
    .from(promptAttachments)
    .innerJoin(attachments, eq(attachments.id, promptAttachments.attachmentId))
    .where(inArray(promptAttachments.promptId, promptIds))
    .orderBy(asc(promptAttachments.position))
    .all()

  const byPrompt = new Map<string, Attachment[]>()

  for (const {promptId, ...attachment} of rows) {
    byPrompt.set(promptId, [...(byPrompt.get(promptId) ?? []), attachment])
  }

  return byPrompt
}

/** Always the originals, never a conversion, so no loss carries over. */
export function originalsOf(
  db: Reader,
  dir: string,
  promptId: string
): HostAttachment[] {
  return db
    .select({
      name: attachments.name,
      mediaType: attachments.mediaType,
      sha256: attachments.sha256,
    })
    .from(promptAttachments)
    .innerJoin(attachments, eq(attachments.id, promptAttachments.attachmentId))
    .where(eq(promptAttachments.promptId, promptId))
    .orderBy(asc(promptAttachments.position))
    .all()
    .map(({name, mediaType, sha256}) => ({
      name,
      mediaType,
      sha256,
      path: originalPath(dir, sha256),
    }))
}

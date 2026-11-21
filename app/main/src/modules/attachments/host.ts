import type {Database} from '#modules/database/main'
import type {AttachmentRow} from './prompts'
import type {HostAttachment, InlineForm} from '@uz/contract/attachments'
import type {ProviderId} from '@uz/contract/providers'

import {ImageMediaTypeSchema, planInline} from '@uz/contract/attachments'

import {originalPath, shrunkPath} from './originals'
import {rowsOf} from './prompts'

/** Where the AI finds it: the copy the app keeps, or a folder's own path. */
function pathOf(dir: string, row: AttachmentRow) {
  if (row.folderPath !== null) return row.folderPath

  if (row.sha256 === null) throw new Error('An attachment has no copy.')

  return originalPath(dir, row.sha256, row.name)
}

function inlineImage(dir: string, row: AttachmentRow, original: string) {
  const shrunk =
    row.shrunkSha256 !== null && row.shrunkMediaType !== null
      ? {
          mediaType: row.shrunkMediaType,
          path: shrunkPath(dir, row.shrunkSha256, row.shrunkMediaType),
        }
      : null

  return {
    type: 'image' as const,
    mediaType: shrunk?.mediaType ?? ImageMediaTypeSchema.parse(row.mediaType),
    path: shrunk?.path ?? original,
  }
}

function toHost(
  dir: string,
  row: AttachmentRow,
  form: InlineForm | null
): HostAttachment {
  const filePath = pathOf(dir, row)

  return {
    name: row.name,
    path: filePath,
    folder: row.folderPath !== null,
    inline:
      form === 'image' ? inlineImage(dir, row, filePath) : form && {type: form},
  }
}

/**
 * What a Provider host gets for each Prompt of a Thread, oldest first with the
 * Prompt being sent last, in the order given. One plan covers the whole
 * Thread, so each file goes inline or not by the rules and the media budget
 * of the Provider the Thread goes to; every one keeps its path (ADR 0022).
 */
export function hostAttachments(
  db: Pick<Database, 'select'>,
  dir: string,
  provider: ProviderId,
  promptIds: string[]
): HostAttachment[][] {
  const byPrompt = rowsOf(db, promptIds)
  const prompts = promptIds.map(promptId => byPrompt.get(promptId) ?? [])
  const {forms} = planInline(provider, prompts)

  return prompts.map((rows, promptAt) =>
    rows.map((row, at) => toHost(dir, row, forms[promptAt]?.[at] ?? null))
  )
}

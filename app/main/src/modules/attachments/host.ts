import type {Database} from '#modules/database/main'
import type {AttachmentRow} from './prompts'
import type {HostAttachment, InlineForm} from '@uz/contract/attachments'
import type {ProviderId} from '@uz/contract/providers'

import {ImageMediaTypeSchema, planInline} from '@uz/contract/attachments'
import path from 'node:path'

import {
  EXTRACTED_TEXT_NAME,
  extractionPath,
  originalPath,
  pageImageName,
  shrunkPath,
} from './originals'
import {extractionOf, rowsOf} from './prompts'

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

/** None for a PDF that goes inline: the Model reads it whole. */
function extractedFiles(
  dir: string,
  row: AttachmentRow,
  form: InlineForm | null
): HostAttachment['extraction'] {
  const extraction = extractionOf(row)

  if (form === 'pdf' || row.sha256 === null || extraction?.status !== 'read') {
    return null
  }

  const folder = extractionPath(dir, row.sha256, extraction.version)

  return {
    text: extraction.text ? path.join(folder, EXTRACTED_TEXT_NAME) : null,
    pageImages: extraction.pageImages.map(page => ({
      page,
      path: path.join(folder, pageImageName(page)),
    })),
    imagesStopped: extraction.imagesStopped,
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
    extraction: extractedFiles(dir, row, form),
  }
}

/**
 * Plans the whole Thread at once: each file goes inline by its Provider's rules
 * and media budget, and keeps its path (ADR 0022).
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

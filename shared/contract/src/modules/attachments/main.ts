import type {ProviderId} from '#modules/providers/main'

import {ExtractionSchema} from '#modules/extraction/main'
import {MIB} from '#modules/sizes/main'
import {z} from 'zod'

export const ATTACHMENT_SIZE_LIMIT = 50 * MIB

export const ATTACHMENTS_PER_PROMPT = 100

/** Pixels, on the long side. */
export const INLINE_IMAGE_PIXELS = 2000

/** A larger image is shrunk before it goes inline. */
export const INLINE_IMAGE_SIZE_LIMIT = 10 * MIB

export const INLINE_IMAGES_PER_PROMPT_LIMIT = 80 * MIB

export const INLINE_TEXT_SIZE_LIMIT = 32 * 1024

/**
 * Counted over the whole Thread. Kept below `claude`'s own limits, past which
 * it drops the oldest without a word.
 */
export const CLAUDE_MEDIA_BUDGET = {base64Bytes: 20 * MIB, files: 90}

export const ImageMediaTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

export type ImageMediaType = z.infer<typeof ImageMediaTypeSchema>

export const FOLDER_MEDIA_TYPE = 'inode/directory'

/**
 * Main reads it from the file's bytes, never from its name or the window. Text
 * is valid UTF-8 with no NUL byte; any other file is an octet stream.
 */
export const AttachmentMediaTypeSchema = z.enum([
  ...ImageMediaTypeSchema.options,
  'application/pdf',
  'text/plain',
  'application/octet-stream',
  FOLDER_MEDIA_TYPE,
])

export type AttachmentMediaType = z.infer<typeof AttachmentMediaTypeSchema>

export type AttachmentKind = 'image' | 'pdf' | 'text' | 'file' | 'folder'

export function attachmentKind(mediaType: AttachmentMediaType): AttachmentKind {
  switch (mediaType) {
    case 'application/pdf':
      return 'pdf'
    case 'text/plain':
      return 'text'
    case 'application/octet-stream':
      return 'file'
    case 'inode/directory':
      return 'folder'
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp':
      return 'image'
    default:
      throw new Error('Unknown attachment type.')
  }
}

export const AttachmentSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  mediaType: AttachmentMediaTypeSchema,
  /** Of the copy the app keeps; 0 for a folder, which is never copied. */
  size: z.number().int().nonnegative(),
  /** Of an image's shrunk inline copy; null if it has none. */
  shrunkSize: z.number().int().positive().nullable(),
  /** A folder's own path; null for a file, which the AI gets a copy of. */
  folderPath: z.string().min(1).nullable(),
  /**
   * The copy can't be read. Main checks when it lists a Tree's Turns and when
   * it answers a send; everywhere else, and for a folder, it is false.
   */
  missing: z.boolean(),
  /** Null for a file no Extraction is made of, and for a folder. */
  extraction: ExtractionSchema.nullable(),
})

export type Attachment = z.infer<typeof AttachmentSchema>

export const FILE_SCHEME = 'uzfile'

export function attachmentUrl(id: string) {
  return `${FILE_SCHEME}://unimatrix-zero/attachments/${id}`
}

export type InlineForm = 'image' | 'pdf' | 'text'

type Sized = Pick<Attachment, 'mediaType' | 'size' | 'shrunkSize'>

function base64Size(bytes: number) {
  return Math.ceil(bytes / 3) * 4
}

export function inlineImageSize({size, shrunkSize}: Sized) {
  return shrunkSize ?? size
}

/** Ignores any media budget; `planInline` applies that (ADR 0022). */
export function inlineForm(
  provider: ProviderId,
  attachment: Sized
): InlineForm | null {
  const {mediaType, size} = attachment

  switch (attachmentKind(mediaType)) {
    case 'image':
      return inlineImageSize(attachment) <= INLINE_IMAGE_SIZE_LIMIT
        ? 'image'
        : null
    case 'pdf':
      return provider === 'claude' &&
        base64Size(size) <= CLAUDE_MEDIA_BUDGET.base64Bytes
        ? 'pdf'
        : null
    case 'text':
      return size <= INLINE_TEXT_SIZE_LIMIT ? 'text' : null
    case 'file':
    case 'folder':
      return null
    default:
      throw new Error('Unknown attachment kind.')
  }
}

export function inlineImagesSize(attachments: readonly Sized[]) {
  return attachments
    .filter(
      attachment =>
        attachmentKind(attachment.mediaType) === 'image' &&
        inlineImageSize(attachment) <= INLINE_IMAGE_SIZE_LIMIT
    )
    .reduce((sum, attachment) => sum + inlineImageSize(attachment), 0)
}

export interface MediaBudgetUse {
  base64Bytes: number
  files: number
  pathOnly: number
}

export interface InlinePlan {
  /** Per Prompt, per attachment, in the order given. */
  forms: (InlineForm | null)[][]
  /**
   * Per Prompt, per attachment: it went inline when its Prompt was newest, and
   * a media budget has since left it out.
   */
  pathOnlyNow: boolean[][]
  /** Null for a Provider with no media budget. */
  budget: MediaBudgetUse | null
}

function mediaSize(form: InlineForm, attachment: Sized) {
  return base64Size(
    form === 'image' ? inlineImageSize(attachment) : attachment.size
  )
}

/**
 * Fills Claude's budget from the newest image or PDF back, and stops at the
 * first that doesn't fit: it and every older one go by path only.
 */
function filled(
  prompts: readonly (readonly Sized[])[],
  forms: readonly (InlineForm | null)[][]
) {
  const used = {base64Bytes: 0, files: 0}
  let full = false

  function taken(form: InlineForm | null, attachment: Sized | undefined) {
    if (form === null || form === 'text' || !attachment) return form

    const bytes = used.base64Bytes + mediaSize(form, attachment)

    full ||=
      bytes > CLAUDE_MEDIA_BUDGET.base64Bytes ||
      used.files === CLAUDE_MEDIA_BUDGET.files

    if (full) return null

    used.base64Bytes = bytes
    used.files += 1

    return form
  }

  const planned = forms
    .map((ofPrompt, promptAt) => ({ofPrompt, promptAt}))
    .toReversed()
    .map(({ofPrompt, promptAt}) =>
      ofPrompt
        .map((form, at) => ({form, attachment: prompts[promptAt]?.[at]}))
        .toReversed()
        .map(({form, attachment}) => taken(form, attachment))
        .toReversed()
    )
    .toReversed()

  return {forms: planned, used}
}

function withinBudget(
  prompts: readonly (readonly Sized[])[],
  forms: readonly (InlineForm | null)[][]
): InlinePlan {
  const {forms: planned, used} = filled(prompts, forms)

  // The fill starts at the newest Prompt, so a Prompt filled by itself gets
  // what it got when it was the newest.
  const pathOnlyNow = forms.map((ofPrompt, promptAt) => {
    const [asNewest] = filled([prompts[promptAt] ?? []], [ofPrompt]).forms

    return ofPrompt.map(
      (_, at) =>
        (asNewest?.[at] ?? null) !== null && planned[promptAt]?.[at] === null
    )
  })

  return {
    forms: planned,
    pathOnlyNow,
    budget: {...used, pathOnly: pathOnlyNow.flat().filter(now => now).length},
  }
}

/** `prompts` run oldest first. Every attachment also goes by its path. */
export function planInline(
  provider: ProviderId,
  prompts: readonly (readonly Sized[])[]
): InlinePlan {
  const forms = prompts.map(attachments =>
    attachments.map(attachment => inlineForm(provider, attachment))
  )

  return provider === 'claude'
    ? withinBudget(prompts, forms)
    : {
        forms,
        pathOnlyNow: forms.map(ofPrompt => ofPrompt.map(() => false)),
        budget: null,
      }
}

export const HostAttachmentSchema = z.strictObject({
  name: z.string().min(1),
  /**
   * Absolute. A file's copy under `userData/attachments/`, ending in the
   * file's own name; a folder's own path.
   */
  path: z.string().min(1),
  folder: z.boolean(),
  inline: z
    .discriminatedUnion('type', [
      z.strictObject({
        type: z.literal('image'),
        mediaType: ImageMediaTypeSchema,
        /** The shrunk copy's when the image has one, else `path`. */
        path: z.string().min(1),
      }),
      z.strictObject({type: z.literal('pdf')}),
      z.strictObject({type: z.literal('text')}),
    ])
    .nullable(),
  /** Null when there is none, and when the file goes inline as a PDF. */
  extraction: z
    .strictObject({
      /** Absolute, like `path`; null when the file has no text. */
      text: z.string().min(1).nullable(),
      pageImages: z.array(
        z.strictObject({
          page: z.number().int().positive(),
          path: z.string().min(1),
        })
      ),
      imagesStopped: z.boolean(),
    })
    .nullable(),
})

export type HostAttachment = z.infer<typeof HostAttachmentSchema>

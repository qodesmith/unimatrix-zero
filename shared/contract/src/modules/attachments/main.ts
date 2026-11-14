import {z} from 'zod'

/** Larger files are refused as they are attached. */
export const ATTACHMENT_SIZE_LIMIT = 20 * 1024 * 1024

/** At most this many go with one Prompt. */
export const ATTACHMENTS_PER_PROMPT = 20

export const ImageMediaTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

/** Main reads it from the file's bytes, never from its name or the window. */
export const AttachmentMediaTypeSchema = z.enum([
  ...ImageMediaTypeSchema.options,
  'application/pdf',
  'text/plain',
])

export type AttachmentMediaType = z.infer<typeof AttachmentMediaTypeSchema>

export type AttachmentKind = 'image' | 'pdf' | 'text'

export function attachmentKind(mediaType: AttachmentMediaType): AttachmentKind {
  switch (mediaType) {
    case 'application/pdf':
      return 'pdf'
    case 'text/plain':
      return 'text'
    case 'image/png':
    case 'image/jpeg':
    case 'image/gif':
    case 'image/webp':
      return 'image'
    default:
      throw new Error('Unknown attachment type.')
  }
}

/** A file the user attached, as the window shows it. */
export const AttachmentSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().min(1),
  mediaType: AttachmentMediaTypeSchema,
  size: z.number().int().nonnegative(),
})

export type Attachment = z.infer<typeof AttachmentSchema>

export const ATTACHMENT_SCHEME = 'uzfile'

/** Where the window loads an attachment's original from (ADR 0014). */
export function attachmentUrl(id: string) {
  return `${ATTACHMENT_SCHEME}://unimatrix-zero/attachments/${id}`
}

/**
 * An attachment as a Provider host is given it: the original, which the host
 * reads and, for a Provider that can't take it as is, converts.
 */
export const HostAttachmentSchema = z.strictObject({
  name: z.string().min(1),
  mediaType: AttachmentMediaTypeSchema,
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  /** Absolute, under `userData/attachments/`. */
  path: z.string().min(1),
})

export type HostAttachment = z.infer<typeof HostAttachmentSchema>

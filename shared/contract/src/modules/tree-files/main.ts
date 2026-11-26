import {FILE_SCHEME} from '#modules/attachments/main'
import {ChangedFileSchema} from '#modules/turns/main'
import {z} from 'zod'

/** Main's name for one file at one Reply's Snapshot; it never holds a path. */
export const TreeFileIdSchema = z.string().regex(/^[\da-f]{32}$/u)

export type TreeFileId = z.infer<typeof TreeFileIdSchema>

/** A file in a Reply's Snapshot, or one the Reply deleted. */
export const TreeFileSchema = z.strictObject({
  id: TreeFileIdSchema,
  /** Inside the Tree's files, with `/` between parts. */
  path: z.string().min(1),
  /** In bytes; a deleted file's size before the Reply deleted it. */
  size: z.number().int().nonnegative(),
  /** What this Reply did to it; null when an earlier Reply left it so. */
  change: ChangedFileSchema.shape.change.nullable(),
})

export type TreeFile = z.infer<typeof TreeFileSchema>

export const TreeFilePreviewSchema = z.enum([
  'image',
  'audio',
  'video',
  'pdf',
  'markdown',
  'csv',
  'html',
  'text',
  /** Nothing the app shows itself: the OS, or the fallback card. */
  'other',
])

export type TreeFilePreview = z.infer<typeof TreeFilePreviewSchema>

export const TreeFileDetailsSchema = z.strictObject({
  ...TreeFileSchema.shape,
  /** Decided from the bytes, and the name only among text or media types. */
  preview: TreeFilePreviewSchema,
  /** Too large for main to preview it as its kind. */
  tooLarge: z.boolean(),
  /**
   * Why Open with its app is refused: marked as a program, or not a document
   * type, which can run on any platform. `program` when both apply.
   */
  notOpened: z.enum(['program', 'not-a-document']).nullable(),
  /** A link, which is never followed. */
  link: z.boolean(),
  /**
   * This Snapshot is the one in the Tree's folder, so the file can be opened
   * and revealed there. False for a deleted file.
   */
  onDisk: z.boolean(),
  /** The editor main found on this computer, offered only when `onDisk`. */
  editor: z.string().nullable(),
  /** Quick Look can show it, on macOS only. */
  quickLook: z.boolean(),
  /** The file manager Reveal shows it in, so its label can name it. */
  fileManager: z.enum(['finder', 'explorer', 'other']),
  /** From the file in the Tree's folder, when `onDisk`. */
  modified: z.iso.datetime().nullable(),
})

export type TreeFileDetails = z.infer<typeof TreeFileDetailsSchema>

/** `html` serves an HTML file to run in an `allow-scripts`-only frame. */
export function treeFileUrl(id: TreeFileId, view?: 'html') {
  const url = `${FILE_SCHEME}://unimatrix-zero/tree-files/${id}`

  return view ? `${url}?view=${view}` : url
}

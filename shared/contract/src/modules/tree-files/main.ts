import {FILE_SCHEME} from '#modules/attachments/main'
import {ChangedFileSchema} from '#modules/turns/main'
import {z} from 'zod'

export const TreeFileIdSchema = z.string().regex(/^[\da-f]{32}$/u)

export type TreeFileId = z.infer<typeof TreeFileIdSchema>

export const TreeFileSchema = z.strictObject({
  id: TreeFileIdSchema,
  path: z.string().min(1),
  size: z.number().int().nonnegative(),
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
  'other',
])

export type TreeFilePreview = z.infer<typeof TreeFilePreviewSchema>

export const TreeFileDetailsSchema = z.strictObject({
  ...TreeFileSchema.shape,
  /** Decided from the bytes, and the name only among text or media types. */
  preview: TreeFilePreviewSchema,
  tooLarge: z.boolean(),
  /**
   * Why Open with its app is refused: marked as a program, or not a document
   * type, which can run on any platform. `program` when both apply.
   */
  notOpened: z.enum(['program', 'not-a-document']).nullable(),
  link: z.boolean(),
  /**
   * This Snapshot is the one in the Tree's folder, so the file can be opened
   * and revealed there. False for a deleted file.
   */
  onDisk: z.boolean(),
  editor: z.string().nullable(),
  quickLook: z.boolean(),
  fileManager: z.enum(['finder', 'explorer', 'other']),
  modified: z.iso.datetime().nullable(),
})

export type TreeFileDetails = z.infer<typeof TreeFileDetailsSchema>

export function treeFileUrl(id: TreeFileId, view?: 'html') {
  const url = `${FILE_SCHEME}://unimatrix-zero/tree-files/${id}`

  return view ? `${url}?view=${view}` : url
}

import {z} from 'zod'

/** A Tree as the UI sees it. Main maps database rows to this. */
export const TREE_TITLE_MAX_LENGTH = 200

export const TreeSchema = z.strictObject({
  id: z.uuid(),
  /** Null until the user or the automatic title names it. */
  title: z.string().nullable(),
  createdAt: z.iso.datetime(),
})

export type Tree = z.infer<typeof TreeSchema>

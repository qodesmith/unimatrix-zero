import {z} from 'zod'

export const TREE_TITLE_MAX_LENGTH = 200

/** A Tree as the UI sees it. */
export const TreeSchema = z.strictObject({
  id: z.uuid(),
  /** Null until the user or the automatic title names it. */
  title: z.string().nullable(),
  /** The root Prompt's first line; null until the root Prompt is sent. */
  firstLine: z.string().max(TREE_TITLE_MAX_LENGTH).nullable(),
  createdAt: z.iso.datetime(),
  /** When its latest Prompt was sent, or `createdAt` before the first. */
  lastActiveAt: z.iso.datetime(),
  /** A Reply in it failed since the Tree was last opened. */
  unseenFailure: z.boolean(),
})

export type Tree = z.infer<typeof TreeSchema>

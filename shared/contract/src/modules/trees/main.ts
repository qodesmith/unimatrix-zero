import {TreeSystemPromptSchema} from '#modules/system-prompts/main'
import {TreeToolsSchema} from '#modules/tools/main'
import {z} from 'zod'

export const TREE_TITLE_MAX_LENGTH = 200

export const TreeSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().nullable(),
  firstLine: z.string().max(TREE_TITLE_MAX_LENGTH).nullable(),
  createdAt: z.iso.datetime(),
  lastActiveAt: z.iso.datetime(),
  unseenFailure: z.boolean(),
  systemPrompt: TreeSystemPromptSchema,
  tools: TreeToolsSchema,
})

export type Tree = z.infer<typeof TreeSchema>

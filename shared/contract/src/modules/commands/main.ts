import {TREE_TITLE_MAX_LENGTH, TreeSchema} from '#modules/trees/main'
import {PromptSchema, ReplySchema} from '#modules/turns/main'
import {z} from 'zod'

export const AppPingCommand = z.strictObject({
  type: z.literal('app.ping'),
  nonce: z.string().min(1),
})

export const AppPingResult = z.strictObject({
  nonce: z.string(),
  receivedAt: z.iso.datetime(),
})

export const TreeCreateCommand = z.strictObject({
  type: z.literal('tree.create'),
})

export const TreeListCommand = z.strictObject({
  type: z.literal('tree.list'),
})

export const TreeListResult = z.strictObject({
  trees: z.array(TreeSchema),
})

export const TreeOpenCommand = z.strictObject({
  type: z.literal('tree.open'),
  treeId: z.uuid(),
})

export const TreeRenameCommand = z.strictObject({
  type: z.literal('tree.rename'),
  treeId: z.uuid(),
  title: z.string().trim().min(1).max(TREE_TITLE_MAX_LENGTH),
})

export const TreeTurnsCommand = z.strictObject({
  type: z.literal('tree.turns'),
  treeId: z.uuid(),
})

export const TreeTurnsResult = z.strictObject({
  prompts: z.array(PromptSchema),
  replies: z.array(ReplySchema),
})

/** The root Prompt of an empty Tree, answered by a connected Provider. */
export const PromptSendCommand = z.strictObject({
  type: z.literal('prompt.send'),
  treeId: z.uuid(),
  text: z.string().trim().min(1),
})

export const PromptSendResult = z.strictObject({
  prompt: PromptSchema,
  reply: ReplySchema,
})

export const CommandSchema = z.discriminatedUnion('type', [
  AppPingCommand,
  TreeCreateCommand,
  TreeListCommand,
  TreeOpenCommand,
  TreeRenameCommand,
  TreeTurnsCommand,
  PromptSendCommand,
])

export type Command = z.infer<typeof CommandSchema>

export type CommandType = Command['type']

const resultSchemas = {
  'app.ping': AppPingResult,
  'tree.create': TreeSchema,
  'tree.list': TreeListResult,
  'tree.open': TreeSchema,
  'tree.rename': TreeSchema,
  'tree.turns': TreeTurnsResult,
  'prompt.send': PromptSendResult,
} as const satisfies Record<CommandType, z.ZodType>

export type CommandResult<T extends CommandType> = z.infer<
  (typeof resultSchemas)[T]
>

export const CommandErrorSchema = z.strictObject({
  code: z.enum([
    'invalid-command',
    'untrusted-sender',
    'not-found',
    'handler-failed',
  ]),
  message: z.string(),
})

export type CommandError = z.infer<typeof CommandErrorSchema>

export type CommandOutcome<T extends CommandType> =
  | {ok: true; value: CommandResult<T>}
  | {ok: false; error: CommandError}

import {
  ATTACHMENTS_PER_PROMPT,
  ATTACHMENT_SIZE_LIMIT,
  AttachmentSchema,
} from '#modules/attachments/main'
import {LayoutSchema, LayoutUpdateSchema} from '#modules/layout/main'
import {ModelChoiceSchema, ProviderIdSchema} from '#modules/providers/main'
import {SettingsSchema, SettingsUpdateSchema} from '#modules/settings/main'
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

/** Opening a Tree shows its failures, so it no longer has an unseen one. */
export const TreeOpenCommand = z.strictObject({
  type: z.literal('tree.open'),
  treeId: z.uuid(),
})

export const TreeRenameCommand = z.strictObject({
  type: z.literal('tree.rename'),
  treeId: z.uuid(),
  title: z.string().trim().min(1).max(TREE_TITLE_MAX_LENGTH),
})

/** The Tree and every Turn in it, for good, once its streaming Replies stop. */
export const TreeDeleteCommand = z.strictObject({
  type: z.literal('tree.delete'),
  treeId: z.uuid(),
})

export const TreeTurnsCommand = z.strictObject({
  type: z.literal('tree.turns'),
  treeId: z.uuid(),
})

export const TreeTurnsResult = z.strictObject({
  prompts: z.array(PromptSchema),
  replies: z.array(ReplySchema),
})

/**
 * Into a Reply that already has a Prompt after it, the Prompt starts a Branch.
 * A failed Prompt there, or a failed root Prompt, goes in the same step.
 */
export const PromptSendCommand = z
  .strictObject({
    type: z.literal('prompt.send'),
    treeId: z.uuid(),
    parentReplyId: z.uuid().nullable(),
    text: z.string().trim(),
    /** From `attachment.add`, in the order the Prompt shows them. */
    attachmentIds: z.array(z.uuid()).max(ATTACHMENTS_PER_PROMPT).optional(),
    /** As the Input's picker shows it; main never swaps it for another. */
    model: ModelChoiceSchema,
  })
  .refine(
    ({text, attachmentIds = []}) => text !== '' || attachmentIds.length > 0,
    {message: 'A Prompt needs text or an attachment.', path: ['text']}
  )

const TurnIdsSchema = z.strictObject({
  promptIds: z.array(z.uuid()),
  replyIds: z.array(z.uuid()),
})

export type TurnIds = z.infer<typeof TurnIdsSchema>

export const PromptSendResult = z.strictObject({
  prompt: PromptSchema,
  reply: ReplySchema,
  /**
   * The failed Prompts and Replies the new Prompt took the place of, with any
   * Turns below them.
   */
  removed: TurnIdsSchema,
})

/** The Prompt and every Turn below it, for good; refused while one streams. */
export const PromptDeleteCommand = z.strictObject({
  type: z.literal('prompt.delete'),
  treeId: z.uuid(),
  promptId: z.uuid(),
})

export const PromptDeleteResult = TurnIdsSchema

/**
 * Keeps the text so far. The Reply ends with its `RUN_FINISHED` once the
 * Provider has let go of the turn.
 */
export const ReplyStopCommand = z.strictObject({
  type: z.literal('reply.stop'),
  treeId: z.uuid(),
  replyId: z.uuid(),
})

/** In place: the Reply streams afresh in the session rewound to before it. */
export const ReplyRetryCommand = z.strictObject({
  type: z.literal('reply.retry'),
  treeId: z.uuid(),
  replyId: z.uuid(),
})

export const ReplyRetryResult = z.strictObject({
  reply: ReplySchema,
})

/** `SIGN_IN_STEP` and `SIGN_IN_FINISHED` follow. */
export const ProviderConnectCommand = z.strictObject({
  type: z.literal('provider.connect'),
  provider: ProviderIdSchema,
})

/** Opens the connecting Provider's sign-in page again, which shows a code. */
export const SignInOpenPageCommand = z.strictObject({
  type: z.literal('sign-in.open-page'),
  provider: ProviderIdSchema,
})

export const SignInCodeCommand = z.strictObject({
  type: z.literal('sign-in.code'),
  provider: ProviderIdSchema,
  code: z.string().trim().min(1),
})

export const SignInCancelCommand = z.strictObject({
  type: z.literal('sign-in.cancel'),
  provider: ProviderIdSchema,
})

/** Fetched without cookies or a referrer; answered with a `data:` URL. */
export const ImageLoadCommand = z.strictObject({
  type: z.literal('image.load'),
  url: z.url({protocol: /^https?$/u}),
})

export const ImageLoadResult = z.strictObject({
  dataUrl: z.string().startsWith('data:image/'),
})

/**
 * Keeps a copy of the file for good, for a Prompt to send. A dropped or picked
 * file comes by the id `registerDroppedFile` gave it; a pasted one, which has
 * no path, by its bytes.
 */
export const AttachmentAddCommand = z.strictObject({
  type: z.literal('attachment.add'),
  file: z.discriminatedUnion('type', [
    z.strictObject({type: z.literal('dropped'), fileId: z.uuid()}),
    z.strictObject({
      type: z.literal('pasted'),
      name: z.string(),
      bytes: z
        .instanceof(Uint8Array)
        .refine(bytes => bytes.byteLength <= ATTACHMENT_SIZE_LIMIT),
    }),
  ]),
})

export const AttachmentAddResult = z.strictObject({
  attachment: AttachmentSchema,
})

/** `SETTINGS_CHANGED` follows with every Setting. */
export const SettingsUpdateCommand = z.strictObject({
  type: z.literal('settings.update'),
  changes: SettingsUpdateSchema,
})

/** `LAYOUT_CHANGED` follows with the whole Layout. */
export const LayoutUpdateCommand = z.strictObject({
  type: z.literal('layout.update'),
  changes: LayoutUpdateSchema,
})

const Done = z.strictObject({})

export const CommandSchema = z.discriminatedUnion('type', [
  AppPingCommand,
  TreeCreateCommand,
  TreeListCommand,
  TreeOpenCommand,
  TreeRenameCommand,
  TreeDeleteCommand,
  TreeTurnsCommand,
  PromptSendCommand,
  PromptDeleteCommand,
  ReplyStopCommand,
  ReplyRetryCommand,
  ProviderConnectCommand,
  SignInOpenPageCommand,
  SignInCodeCommand,
  SignInCancelCommand,
  ImageLoadCommand,
  AttachmentAddCommand,
  SettingsUpdateCommand,
  LayoutUpdateCommand,
])

export type Command = z.infer<typeof CommandSchema>

export type CommandType = Command['type']

const resultSchemas = {
  'app.ping': AppPingResult,
  'tree.create': TreeSchema,
  'tree.list': TreeListResult,
  'tree.open': TreeSchema,
  'tree.rename': TreeSchema,
  'tree.delete': Done,
  'tree.turns': TreeTurnsResult,
  'prompt.send': PromptSendResult,
  'prompt.delete': PromptDeleteResult,
  'reply.stop': Done,
  'reply.retry': ReplyRetryResult,
  'provider.connect': Done,
  'sign-in.open-page': Done,
  'sign-in.code': Done,
  'sign-in.cancel': Done,
  'image.load': ImageLoadResult,
  'attachment.add': AttachmentAddResult,
  'settings.update': SettingsSchema,
  'layout.update': LayoutSchema,
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

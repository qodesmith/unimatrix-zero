import {
  ATTACHMENTS_PER_PROMPT,
  ATTACHMENT_SIZE_LIMIT,
  AttachmentSchema,
  INLINE_IMAGE_SIZE_LIMIT,
} from '#modules/attachments/main'
import {LayoutSchema, LayoutUpdateSchema} from '#modules/layout/main'
import {ModelChoiceSchema, ProviderIdSchema} from '#modules/providers/main'
import {SettingsSchema, SettingsUpdateSchema} from '#modules/settings/main'
import {
  SystemPromptEntryIdSchema,
  SystemPromptEntrySchema,
  SystemPromptNameSchema,
  SystemPromptTextSchema,
} from '#modules/system-prompts/main'
import {TreeToolsSchema} from '#modules/tools/main'
import {
  TreeFileDetailsSchema,
  TreeFileIdSchema,
  TreeFileSchema,
} from '#modules/tree-files/main'
import {TREE_TITLE_MAX_LENGTH, TreeSchema} from '#modules/trees/main'
import {
  ApprovalAnswerSchema,
  PromptSchema,
  ReplySchema,
} from '#modules/turns/main'
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

export const TreeDeleteCommand = z.strictObject({
  type: z.literal('tree.delete'),
  treeId: z.uuid(),
})

export const TreeSetSystemPromptCommand = z.strictObject({
  type: z.literal('tree.set-system-prompt'),
  treeId: z.uuid(),
  text: SystemPromptTextSchema,
})

export const TreeSetToolsCommand = z.strictObject({
  type: z.literal('tree.set-tools'),
  treeId: z.uuid(),
  changes: TreeToolsSchema.partial(),
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
    attachmentIds: z.array(z.uuid()).max(ATTACHMENTS_PER_PROMPT).optional(),
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
  removed: TurnIdsSchema,
})

export const PromptDeleteCommand = z.strictObject({
  type: z.literal('prompt.delete'),
  treeId: z.uuid(),
  promptId: z.uuid(),
})

export const PromptDeleteResult = TurnIdsSchema

export const ReplyStopCommand = z.strictObject({
  type: z.literal('reply.stop'),
  treeId: z.uuid(),
  replyId: z.uuid(),
})

export const ReplyAnswerApprovalCommand = z.strictObject({
  type: z.literal('reply.answer-approval'),
  treeId: z.uuid(),
  replyId: z.uuid(),
  approvalId: z.string(),
  answer: ApprovalAnswerSchema,
})

export const ReplyRetryCommand = z.strictObject({
  type: z.literal('reply.retry'),
  treeId: z.uuid(),
  replyId: z.uuid(),
})

export const ReplyRetryResult = z.strictObject({
  reply: ReplySchema,
})

export const ProviderConnectCommand = z.strictObject({
  type: z.literal('provider.connect'),
  provider: ProviderIdSchema,
})

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

export const ImageLoadCommand = z.strictObject({
  type: z.literal('image.load'),
  url: z.url({protocol: /^https?$/u}),
})

export const ImageLoadResult = z.strictObject({
  dataUrl: z.string().startsWith('data:image/'),
})

/**
 * A dropped or picked file comes by the id `registerDroppedFile` gave it; a
 * pasted one, with no path, by its bytes. A folder is kept as its path alone.
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
  shrunk: z
    .instanceof(Uint8Array)
    .refine(bytes => bytes.byteLength <= INLINE_IMAGE_SIZE_LIMIT)
    .optional(),
})

export const AttachmentAddResult = z.strictObject({
  attachment: AttachmentSchema,
})

export const SnapshotsDownloadAgainCommand = z.strictObject({
  type: z.literal('snapshots.download-again'),
})

export const SettingsUpdateCommand = z.strictObject({
  type: z.literal('settings.update'),
  changes: SettingsUpdateSchema,
})

export const SystemPromptCreateCommand = z.strictObject({
  type: z.literal('system-prompt.create'),
  name: SystemPromptNameSchema,
  text: SystemPromptTextSchema,
})

/** Refused for a preset; changes no Tree. */
export const SystemPromptUpdateCommand = z.strictObject({
  type: z.literal('system-prompt.update'),
  id: SystemPromptEntryIdSchema,
  name: SystemPromptNameSchema,
  text: SystemPromptTextSchema,
})

/** Refused for a preset; the default for new Trees falls back to Default. */
export const SystemPromptDeleteCommand = z.strictObject({
  type: z.literal('system-prompt.delete'),
  id: SystemPromptEntryIdSchema,
})

export const TreeFilesListCommand = z.strictObject({
  type: z.literal('tree-files.list'),
  treeId: z.uuid(),
  replyId: z.uuid(),
})

export const TreeFilesListResult = z.strictObject({
  files: z.array(TreeFileSchema),
  onDisk: z.boolean(),
})

export const TreeFilesSaveCopyCommand = z.strictObject({
  type: z.literal('tree-files.save-copy'),
  treeId: z.uuid(),
  replyId: z.uuid(),
})

export const SavedResult = z.strictObject({
  saved: z.boolean(),
})

export const TreeFileDescribeCommand = z.strictObject({
  type: z.literal('tree-file.describe'),
  fileId: TreeFileIdSchema,
})

const TreeFileOpenWithSchema = z.enum([
  'default-app',
  'browser',
  'editor',
  'quick-look',
])

export type TreeFileOpenWith = z.infer<typeof TreeFileOpenWithSchema>

/**
 * In the Tree's folder when `onDisk`, else a read-only copy of this Snapshot's
 * file. `default-app` is refused for a file `notOpened`, and `browser` for a
 * program or a file that isn't HTML.
 */
export const TreeFileOpenCommand = z.strictObject({
  type: z.literal('tree-file.open'),
  fileId: TreeFileIdSchema,
  with: TreeFileOpenWithSchema,
})

export const TreeFileRevealCommand = z.strictObject({
  type: z.literal('tree-file.reveal'),
  fileId: TreeFileIdSchema,
})

export const TreeFileSaveCopyCommand = z.strictObject({
  type: z.literal('tree-file.save-copy'),
  fileId: TreeFileIdSchema,
})

export const TreeFileThumbnailCommand = z.strictObject({
  type: z.literal('tree-file.thumbnail'),
  fileId: TreeFileIdSchema,
})

export const TreeFileThumbnailResult = z.strictObject({
  dataUrl: z.string().startsWith('data:image/').nullable(),
})

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
  TreeSetSystemPromptCommand,
  TreeSetToolsCommand,
  PromptSendCommand,
  PromptDeleteCommand,
  ReplyStopCommand,
  ReplyRetryCommand,
  ReplyAnswerApprovalCommand,
  ProviderConnectCommand,
  SignInOpenPageCommand,
  SignInCodeCommand,
  SignInCancelCommand,
  ImageLoadCommand,
  AttachmentAddCommand,
  SettingsUpdateCommand,
  SystemPromptCreateCommand,
  SystemPromptUpdateCommand,
  SystemPromptDeleteCommand,
  LayoutUpdateCommand,
  SnapshotsDownloadAgainCommand,
  TreeFilesListCommand,
  TreeFilesSaveCopyCommand,
  TreeFileDescribeCommand,
  TreeFileOpenCommand,
  TreeFileRevealCommand,
  TreeFileSaveCopyCommand,
  TreeFileThumbnailCommand,
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
  'tree.set-system-prompt': TreeSchema,
  'tree.set-tools': TreeSchema,
  'prompt.send': PromptSendResult,
  'prompt.delete': PromptDeleteResult,
  'reply.stop': Done,
  'reply.retry': ReplyRetryResult,
  'reply.answer-approval': Done,
  'provider.connect': Done,
  'sign-in.open-page': Done,
  'sign-in.code': Done,
  'sign-in.cancel': Done,
  'image.load': ImageLoadResult,
  'attachment.add': AttachmentAddResult,
  'settings.update': SettingsSchema,
  'system-prompt.create': SystemPromptEntrySchema,
  'system-prompt.update': SystemPromptEntrySchema,
  'system-prompt.delete': Done,
  'layout.update': LayoutSchema,
  'snapshots.download-again': Done,
  'tree-files.list': TreeFilesListResult,
  'tree-files.save-copy': SavedResult,
  'tree-file.describe': TreeFileDetailsSchema,
  'tree-file.open': Done,
  'tree-file.reveal': Done,
  'tree-file.save-copy': SavedResult,
  'tree-file.thumbnail': TreeFileThumbnailResult,
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

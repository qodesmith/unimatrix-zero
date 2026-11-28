import type {
  Capabilities,
  Connection,
  Model,
  SignInUpdate,
  Usage,
} from '#modules/providers/main'
import type {ApprovalAnswer, ReplyEvent} from '#modules/turns/main'

import {HostAttachmentSchema} from '#modules/attachments/main'
import {VendorBuildSchema} from '#modules/manifest/main'
import {
  ApprovalGrantSchema,
  PermissionModeSchema,
} from '#modules/permissions/main'
import {ModelSchema, SignInUpdateSchema} from '#modules/providers/main'
import {CompactionSettingsSchema} from '#modules/settings/main'
import {TreeToolsSchema} from '#modules/tools/main'
import {
  ApprovalAnswerSchema,
  ReplyEventSchema,
  ReplyPartSchema,
} from '#modules/turns/main'
import {z} from 'zod'

import {
  SessionStoreRequestSchema,
  SessionStoreValueSchema,
} from './session-store'

export * from './session-store'

export const SessionRefSchema = z.strictObject({
  sessionId: z.string(),
  messageId: z.string().nullable(),
})

export type SessionRef = z.infer<typeof SessionRefSchema>

export const SignInRequestSchema = z.strictObject({
  /** Null when the manifest names none; only the fake driver accepts that. */
  program: z
    .strictObject({path: z.string().min(1), build: VendorBuildSchema})
    .nullable(),
  configDir: z.string().min(1),
  developerDir: z.string().min(1).optional(),
  /** Windows and Linux: goes last on `PATH`, so the user's own `git` wins. */
  gitFolder: z.string().min(1).optional(),
})

export type SignInRequest = z.infer<typeof SignInRequestSchema>

export const SessionCutSchema = SessionRefSchema.extend({
  type: z.literal('cut'),
  keepThrough: z.string().nullable(),
  dropFrom: z.string().nullable(),
})

export type SessionCut = z.infer<typeof SessionCutSchema>

export const DeletionCutSchema = SessionCutSchema.extend({
  dropFrom: z.string(),
})

export type DeletionCut = z.infer<typeof DeletionCutSchema>

export const ReplySessionSchema = z.discriminatedUnion('type', [
  SessionRefSchema.extend({type: z.literal('continue')}),
  SessionRefSchema.extend({
    type: z.literal('fork'),
    /**
     * Set when the session compacted after `messageId`: served whole, it no
     * longer reaches it.
     */
    servedThrough: z.string().min(1).optional(),
  }),
  SessionRefSchema.extend({type: z.literal('rewind')}),
  SessionCutSchema,
])

export type ReplySession = z.infer<typeof ReplySessionSchema>

export const ThreadSchema = z.array(
  z.strictObject({
    prompt: z.string(),
    attachments: z.array(HostAttachmentSchema),
    reply: z.array(ReplyPartSchema),
    label: z.string().min(1).nullable(),
  })
)

export type Thread = z.infer<typeof ThreadSchema>

export function replyLabel(name: string) {
  return `[Reply written by ${name}]`
}

const UuidPartsSchema = z.templateLiteral([
  z.string(),
  '-',
  z.string(),
  '-',
  z.string(),
  '-',
  z.string(),
  '-',
  z.string(),
])

export const ReplyRequestSchema = z.strictObject({
  treeId: z.uuid(),
  replyId: z.uuid(),
  model: z.string().min(1),
  systemPrompt: z.string(),
  prompt: z.strictObject({
    text: z.string(),
    attachments: z.array(HostAttachmentSchema),
    messageId: z.uuid().pipe(UuidPartsSchema),
  }),
  vendorProgram: SignInRequestSchema,
  treeFolder: z.string().min(1),
  session: ReplySessionSchema.nullable(),
  thread: ThreadSchema,
  compactionSettings: CompactionSettingsSchema,
  /** Codex keeps a thread's first System prompt for good; Claude ignores this. */
  systemPromptChanged: z.boolean(),
  tools: TreeToolsSchema,
  permissionMode: PermissionModeSchema,
  hiddenFolders: z.array(z.string().min(1)),
  treesFolder: z.string().min(1),
  grants: z.array(ApprovalGrantSchema),
})

export type ReplyRequest = z.infer<typeof ReplyRequestSchema>

export const ReplyRecordedMessage = z.strictObject({
  type: z.literal('REPLY_RECORDED'),
  treeId: z.uuid(),
  replyId: z.uuid(),
  model: z.string().min(1),
  session: SessionRefSchema.extend({messageId: z.string()}),
})

export type ReplyRecorded = z.infer<typeof ReplyRecordedMessage>

/**
 * The session holds the Reply's Prompt as `messageId`, though the Reply may
 * never finish.
 */
export const PromptRecordedMessage = z.strictObject({
  type: z.literal('PROMPT_RECORDED'),
  treeId: z.uuid(),
  replyId: z.uuid(),
  session: SessionRefSchema.extend({messageId: z.string()}),
})

export type PromptRecorded = z.infer<typeof PromptRecordedMessage>

export const PromptDroppedMessage = z.strictObject({
  type: z.literal('PROMPT_DROPPED'),
  treeId: z.uuid(),
  replyId: z.uuid(),
})

export type PromptDropped = z.infer<typeof PromptDroppedMessage>

export const SessionCutMessage = z.strictObject({
  type: z.literal('SESSION_CUT'),
  treeId: z.uuid(),
  replyId: z.uuid(),
  dropFrom: z.string(),
})

export type SessionCutReport = z.infer<typeof SessionCutMessage>

export type StartReplyEvent =
  | ReplyEvent
  | PromptRecorded
  | PromptDropped
  | ReplyRecorded

const replyEventTypes = new Set<StartReplyEvent['type']>(
  ReplyEventSchema.options.map(option => option.shape.type.value)
)

export function isReplyEvent(event: StartReplyEvent): event is ReplyEvent {
  return replyEventTypes.has(event.type)
}

export const OneShotRequestSchema = z.strictObject({
  model: z.string().min(1),
  prompt: z.string().min(1),
  vendorProgram: SignInRequestSchema,
})

export type OneShotRequest = z.infer<typeof OneShotRequestSchema>

export interface ProviderDriver {
  readonly capabilities: Capabilities
  readConnection(): Promise<Connection>
  signIn(request: SignInRequest): AsyncIterable<SignInUpdate>
  signInPageOpened(): void
  submitSignInCode(code: string): void
  cancelSignIn(): void
  listModels(vendorProgram: SignInRequest): Promise<Model[]>
  onModelsChanged(listener: (models: Model[]) => void): void
  smallestModel(): Promise<string | null>
  readUsage(): Promise<Usage>
  /**
   * Ends with `RUN_FINISHED`, even after `stop`. `PROMPT_DROPPED` follows a
   * Retry's cut of `dropFrom`; `PROMPT_RECORDED` once the session holds a
   * Prompt the driver named itself; `REPLY_RECORDED` before the end.
   */
  startReply(request: ReplyRequest): AsyncIterable<StartReplyEvent>
  stop(replyId: string): Promise<void>
  answerApproval(approvalId: string, answer: ApprovalAnswer): Promise<void>
  forkSession(input: {
    session: SessionRef
    atMessageId: string
  }): Promise<SessionRef>
  /**
   * Drops Turns the Tree deleted. True once the session no longer holds
   * `dropFrom`; false when the cut waits for the next Reply in the session.
   */
  cutSession(input: {
    session: DeletionCut
    vendorProgram: SignInRequest
  }): Promise<boolean>
  /**
   * Tool-free, outside any Tree. Once `signal` aborts, a driver still waiting
   * on the answer ends its vendor program.
   */
  runOneShot(input: OneShotRequest, signal: AbortSignal): Promise<string>
  mcpSignIn(serverId: string): Promise<void>
}

export const HostCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('reply.start'), request: ReplyRequestSchema}),
  z.strictObject({type: z.literal('reply.stop'), replyId: z.uuid()}),
  z.strictObject({
    type: z.literal('approval.answer'),
    approvalId: z.string(),
    answer: ApprovalAnswerSchema,
  }),
  z.strictObject({
    type: z.literal('session.cut'),
    treeId: z.uuid(),
    replyId: z.uuid(),
    session: DeletionCutSchema,
    vendorProgram: SignInRequestSchema,
  }),
  z.strictObject({
    type: z.literal('one-shot.run'),
    requestId: z.string().min(1),
    request: OneShotRequestSchema,
  }),
  z.strictObject({
    type: z.literal('one-shot.cancel'),
    requestId: z.string().min(1),
  }),
  z.strictObject({
    type: z.literal('sign-in.start'),
    request: SignInRequestSchema,
  }),
  z.strictObject({type: z.literal('sign-in.page-opened')}),
  z.strictObject({type: z.literal('sign-in.code'), code: z.string()}),
  z.strictObject({type: z.literal('sign-in.cancel')}),
  z.strictObject({
    type: z.literal('models.list'),
    vendorProgram: SignInRequestSchema,
  }),
  z.strictObject({
    type: z.literal('session-store.result'),
    requestId: z.string(),
    outcome: z.discriminatedUnion('ok', [
      z.strictObject({ok: z.literal(true), value: SessionStoreValueSchema}),
      z.strictObject({ok: z.literal(false), message: z.string()}),
    ]),
  }),
])

export type HostCommand = z.infer<typeof HostCommandSchema>

export const HostReadyMessage = z.strictObject({
  type: z.literal('HOST_READY'),
  smallestModel: z.string().min(1).nullable(),
})

export const HostModelsChangedMessage = z.strictObject({
  type: z.literal('MODELS_CHANGED'),
  models: z.array(ModelSchema),
})

export const OneShotFinishedMessage = z.strictObject({
  type: z.literal('ONE_SHOT_FINISHED'),
  requestId: z.string().min(1),
  outcome: z.discriminatedUnion('ok', [
    z.strictObject({ok: z.literal(true), text: z.string()}),
    z.strictObject({ok: z.literal(false), message: z.string()}),
  ]),
})

export type OneShotFinished = z.infer<typeof OneShotFinishedMessage>

export const SessionStoreMessage = z.strictObject({
  type: z.literal('SESSION_STORE'),
  requestId: z.string(),
  request: SessionStoreRequestSchema,
})

export const HostMessageSchema = z.discriminatedUnion('type', [
  HostReadyMessage,
  HostModelsChangedMessage,
  ReplyEventSchema,
  PromptRecordedMessage,
  PromptDroppedMessage,
  ReplyRecordedMessage,
  SessionCutMessage,
  OneShotFinishedMessage,
  SignInUpdateSchema,
  SessionStoreMessage,
])

export type HostMessage = z.infer<typeof HostMessageSchema>

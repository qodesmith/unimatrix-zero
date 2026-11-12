import type {
  Capabilities,
  Connection,
  Model,
  SignInUpdate,
  Usage,
} from '#modules/providers/main'
import type {ApprovalAnswer, ReplyEvent} from '#modules/turns/main'

import {VendorBuildSchema} from '#modules/manifest/main'
import {ModelSchema, SignInUpdateSchema} from '#modules/providers/main'
import {CompactionSchema} from '#modules/settings/main'
import {ReplyEventSchema, ReplyPartSchema} from '#modules/turns/main'
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
  /** The vendor program's own configuration folder, which holds its sign-in. */
  configDir: z.string().min(1),
})

export type SignInRequest = z.infer<typeof SignInRequestSchema>

/**
 * Keeps the session through `keepThrough` and drops `dropFrom` with all after
 * it. Each Provider cuts at the one it can; a null one leaves the session be.
 */
export const SessionCutSchema = SessionRefSchema.extend({
  type: z.literal('cut'),
  keepThrough: z.string().nullable(),
  dropFrom: z.string().nullable(),
})

export type SessionCut = z.infer<typeof SessionCutSchema>

/** Drops the first Prompt of Turns the Tree deleted, with all after it. */
export const DeletionCutSchema = SessionCutSchema.extend({
  dropFrom: z.string(),
})

export type DeletionCut = z.infer<typeof DeletionCutSchema>

/** The Provider session a Reply is written in, at the Reply being answered. */
export const ReplySessionSchema = z.discriminatedUnion('type', [
  SessionRefSchema.extend({type: z.literal('continue')}),
  /** The Reply already has a Prompt after it; forking spares that Branch. */
  SessionRefSchema.extend({
    type: z.literal('fork'),
    /**
     * The entry the Provider is served the session through, when the session
     * compacted after `messageId`: served whole, it no longer reaches it.
     */
    servedThrough: z.string().min(1).optional(),
  }),
  /** The session may run past `messageId` with a failed turn, dropped first. */
  SessionRefSchema.extend({type: z.literal('rewind')}),
  SessionCutSchema,
])

export type ReplySession = z.infer<typeof ReplySessionSchema>

/** The shape `node:crypto` types a UUID as, which the Claude SDK asks for. */
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
    /** Main's name for the Prompt in the session, for a Provider that takes one. */
    messageId: z.uuid().pipe(UuidPartsSchema),
  }),
  vendorProgram: SignInRequestSchema,
  /** Null starts a session. */
  session: ReplySessionSchema.nullable(),
  compaction: CompactionSchema,
})

export type ReplyRequest = z.infer<typeof ReplyRequestSchema>

/** Main keeps this on the Reply; the window never sees it. */
export const ReplyRecordedMessage = z.strictObject({
  type: z.literal('REPLY_RECORDED'),
  treeId: z.uuid(),
  replyId: z.uuid(),
  model: z.string().min(1),
  session: SessionRefSchema.extend({messageId: z.string()}),
})

export type ReplyRecorded = z.infer<typeof ReplyRecordedMessage>

/**
 * The Provider session holds the Reply's Prompt, as `messageId`, though the
 * Reply may never finish. Main keeps it on the Reply for a Retry's cut.
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

/** The Provider session no longer holds `dropFrom`, past the Reply `replyId`. */
export const SessionCutMessage = z.strictObject({
  type: z.literal('SESSION_CUT'),
  treeId: z.uuid(),
  replyId: z.uuid(),
  dropFrom: z.string(),
})

export type SessionCutReport = z.infer<typeof SessionCutMessage>

export const ThreadSchema = z.array(
  z.strictObject({prompt: z.string(), reply: z.array(ReplyPartSchema)})
)

export type Thread = z.infer<typeof ThreadSchema>

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

/** One Provider, one account; no vendor SDK type leaves its Provider host. */
export interface ProviderDriver {
  readonly capabilities: Capabilities
  readConnection(): Promise<Connection>
  /** Ends with `SIGN_IN_FINISHED`, including after `cancelSignIn`. */
  signIn(request: SignInRequest): AsyncIterable<SignInUpdate>
  /** The app opened the sign-in page again; that page shows a code. */
  signInPageOpened(): void
  submitSignInCode(code: string): void
  cancelSignIn(): void
  /**
   * The Models the account may pick now, starting its vendor program if it
   * must.
   */
  listModels(vendorProgram: SignInRequest): Promise<Model[]>
  /** Lists the driver learned on its own, such as from a session it started. */
  onModelsChanged(listener: (models: Model[]) => void): void
  /** For one-shots; null when the account can't run them. */
  smallestModel(): Promise<string | null>
  readUsage(): Promise<Usage>
  /**
   * Ends with `RUN_FINISHED`, including after `stop`. `PROMPT_DROPPED` comes
   * once a Retry's cut drops `dropFrom`, `PROMPT_RECORDED`, from a driver that
   * names the Prompt itself, once the session holds it, and `REPLY_RECORDED`,
   * before the end, once the Provider saved it. Main records a Prompt stored
   * under `prompt.messageId` as it stores the entry.
   */
  startReply(request: ReplyRequest): AsyncIterable<StartReplyEvent>
  stop(replyId: string): Promise<void>
  answerApproval(approvalId: string, answer: ApprovalAnswer): Promise<void>
  forkSession(input: {
    session: SessionRef
    atMessageId: string
  }): Promise<SessionRef>
  rebuildSession(input: {thread: Thread}): Promise<SessionRef>
  /**
   * Drops Turns the Tree deleted. True once the session no longer holds
   * `dropFrom`; false when the cut waits for the next Reply in the session.
   */
  cutSession(input: {
    session: DeletionCut
    vendorProgram: SignInRequest
  }): Promise<boolean>
  /**
   * A tiny tool-free request outside any Tree: titles, Summaries. `signal`
   * aborts once main gives up on it; a driver still waiting on the answer
   * then ends its vendor program.
   */
  runOneShot(input: OneShotRequest, signal: AbortSignal): Promise<string>
  mcpSignIn(serverId: string): Promise<void>
}

/** Main → Provider host. */
export const HostCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('reply.start'), request: ReplyRequestSchema}),
  /** Interrupts the Reply's turn; its `RUN_FINISHED` follows. */
  z.strictObject({type: z.literal('reply.stop'), replyId: z.uuid()}),
  /** `SESSION_CUT` follows once the driver's `cutSession` has cut. */
  z.strictObject({
    type: z.literal('session.cut'),
    treeId: z.uuid(),
    replyId: z.uuid(),
    session: DeletionCutSchema,
    vendorProgram: SignInRequestSchema,
  }),
  /** `ONE_SHOT_FINISHED` follows with the same `requestId`. */
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
  /** `MODELS_CHANGED` follows once the driver can list them. */
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

/** Provider host → main. */
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

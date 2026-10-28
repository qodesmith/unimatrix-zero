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
import {ReplyEventSchema, ReplyPartSchema} from '#modules/turns/main'
import {z} from 'zod'

import {
  SessionStoreRequestSchema,
  SessionStoreValueSchema,
} from './session-store'

export * from './session-store'

/** Where a Provider session stands: the session, and a message inside it. */
export const SessionRefSchema = z.strictObject({
  sessionId: z.string(),
  messageId: z.string().nullable(),
})

export type SessionRef = z.infer<typeof SessionRefSchema>

/** What a driver needs to connect its Provider. */
export const SignInRequestSchema = z.strictObject({
  /** Null when the manifest names none; only the fake driver accepts that. */
  program: z
    .strictObject({path: z.string().min(1), build: VendorBuildSchema})
    .nullable(),
  /** The vendor program's own configuration folder, which holds its sign-in. */
  configDir: z.string().min(1),
})

export type SignInRequest = z.infer<typeof SignInRequestSchema>

export const ReplyRequestSchema = z.strictObject({
  treeId: z.uuid(),
  replyId: z.uuid(),
  model: z.string().min(1),
  systemPrompt: z.string(),
  prompt: z.strictObject({text: z.string()}),
  vendorProgram: SignInRequestSchema,
  /**
   * At the Reply being answered; null starts a session. `fork`: the Reply
   * already has a Prompt after it, so the Provider forks there and the other
   * Branch's session is never rewound. `rewind`: the session may run past
   * `messageId` with a failed turn, dropped first; never set with `fork`.
   * `retryCut`: a Retry whose Prompt answers a Reply cut short before its
   * Provider saved it. The session keeps everything through `keepThrough`,
   * that Reply's Prompt, and drops `dropFrom`, the failed attempt's own Prompt,
   * with all after it. Each Provider cuts at the one it can; a null one leaves
   * the session as it is.
   */
  session: SessionRefSchema.extend({
    fork: z.boolean(),
    rewind: z.boolean(),
    retryCut: z
      .strictObject({
        keepThrough: z.string().nullable(),
        dropFrom: z.string().nullable(),
      })
      .optional(),
  }).nullable(),
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

/** A Retry's cut dropped the Prompt recorded for this Reply. */
export const PromptDroppedMessage = z.strictObject({
  type: z.literal('PROMPT_DROPPED'),
  treeId: z.uuid(),
  replyId: z.uuid(),
})

export type PromptDropped = z.infer<typeof PromptDroppedMessage>

/** A Thread as any Provider can take it: each Prompt and the Reply to it. */
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
  listModels(): Promise<Model[]>
  readUsage(): Promise<Usage>
  /**
   * Ends with `RUN_FINISHED`, including after `stop`. `PROMPT_DROPPED` comes
   * once a Retry's cut drops `dropFrom`, `PROMPT_RECORDED` once the Provider
   * session holds the Prompt, and `REPLY_RECORDED` before the end once the
   * Provider has saved the Reply.
   */
  startReply(request: ReplyRequest): AsyncIterable<StartReplyEvent>
  stop(replyId: string): Promise<void>
  answerApproval(approvalId: string, answer: ApprovalAnswer): Promise<void>
  forkSession(input: {
    session: SessionRef
    atMessageId: string
  }): Promise<SessionRef>
  rebuildSession(input: {thread: Thread}): Promise<SessionRef>
  rewindSession(input: {
    session: SessionRef
    toMessageId: string
  }): Promise<void>
  /** A tiny tool-free request outside any Tree: titles, Summaries. */
  runOneShot(input: {model: string; prompt: string}): Promise<string>
  mcpSignIn(serverId: string): Promise<void>
}

/** Main → Provider host. */
export const HostCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('reply.start'), request: ReplyRequestSchema}),
  /** Interrupts the Reply's turn; its `RUN_FINISHED` follows. */
  z.strictObject({type: z.literal('reply.stop'), replyId: z.uuid()}),
  z.strictObject({
    type: z.literal('sign-in.start'),
    request: SignInRequestSchema,
  }),
  z.strictObject({type: z.literal('sign-in.page-opened')}),
  z.strictObject({type: z.literal('sign-in.code'), code: z.string()}),
  z.strictObject({type: z.literal('sign-in.cancel')}),
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
  /** Empty until the driver can write Replies. */
  models: z.array(ModelSchema),
})

/** Asks main to keep, or give back, part of a Provider session. */
export const SessionStoreMessage = z.strictObject({
  type: z.literal('SESSION_STORE'),
  requestId: z.string(),
  request: SessionStoreRequestSchema,
})

/** Provider host → main. */
export const HostMessageSchema = z.discriminatedUnion('type', [
  HostReadyMessage,
  ReplyEventSchema,
  PromptRecordedMessage,
  PromptDroppedMessage,
  ReplyRecordedMessage,
  SignInUpdateSchema,
  SessionStoreMessage,
])

export type HostMessage = z.infer<typeof HostMessageSchema>

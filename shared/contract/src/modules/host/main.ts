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
  /**
   * Where the vendor program goes and what to download. Null when the
   * manifest names none for the Provider, which only the fake driver accepts.
   */
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
  /** The vendor program and its configuration folder, as when connecting. */
  vendor: SignInRequestSchema,
  /** The session to continue, at the Reply being answered; null starts one. */
  session: SessionRefSchema.nullable(),
})

export type ReplyRequest = z.infer<typeof ReplyRequestSchema>

/**
 * The Provider has saved the Reply in its session: where it sits there, and
 * the Model that wrote it. Main keeps both on the Reply; the window never
 * sees this.
 */
export const ReplyRecordedMessage = z.strictObject({
  type: z.literal('REPLY_RECORDED'),
  treeId: z.uuid(),
  replyId: z.uuid(),
  model: z.string().min(1),
  session: z.strictObject({sessionId: z.string(), messageId: z.string()}),
})

export type ReplyRecorded = z.infer<typeof ReplyRecordedMessage>

/** A Thread as any Provider can take it: each Prompt and the Reply to it. */
export const ThreadSchema = z.array(
  z.strictObject({prompt: z.string(), reply: z.array(ReplyPartSchema)})
)

export type Thread = z.infer<typeof ThreadSchema>

/**
 * One Provider, one account. Each runs inside its Provider host and turns the
 * vendor's SDK into the contract's events; nothing outside the host sees the
 * vendor's types.
 */
export interface ProviderDriver {
  readonly capabilities: Capabilities
  readConnection(): Promise<Connection>
  /**
   * Gets the vendor program ready, signs in and checks the plan. Ends with
   * `SIGN_IN_FINISHED`, including after `cancelSignIn`.
   */
  signIn(request: SignInRequest): AsyncIterable<SignInUpdate>
  /** The app opened the sign-in page again; that page shows a code. */
  signInPageOpened(): void
  submitSignInCode(code: string): void
  cancelSignIn(): void
  listModels(): Promise<Model[]>
  readUsage(): Promise<Usage>
  /**
   * Ends with `RUN_FINISHED`, including after `stop`. `REPLY_RECORDED` comes
   * before it once the Provider has saved the Reply.
   */
  startReply(request: ReplyRequest): AsyncIterable<ReplyEvent | ReplyRecorded>
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
  z.strictObject({
    type: z.literal('sign-in.start'),
    request: SignInRequestSchema,
  }),
  z.strictObject({type: z.literal('sign-in.page-opened')}),
  z.strictObject({type: z.literal('sign-in.code'), code: z.string()}),
  z.strictObject({type: z.literal('sign-in.cancel')}),
  /** Main's answer to a `SESSION_STORE` request. */
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
  ReplyRecordedMessage,
  SignInUpdateSchema,
  SessionStoreMessage,
])

export type HostMessage = z.infer<typeof HostMessageSchema>

import type {
  Capabilities,
  Connection,
  Model,
  Usage,
} from '#modules/providers/main'
import type {ApprovalAnswer, ReplyEvent} from '#modules/turns/main'

import {ModelSchema} from '#modules/providers/main'
import {ReplyEventSchema, ReplyPartSchema} from '#modules/turns/main'
import {z} from 'zod'

export const ReplyRequestSchema = z.strictObject({
  treeId: z.uuid(),
  replyId: z.uuid(),
  model: z.string().min(1),
  systemPrompt: z.string(),
  prompt: z.strictObject({text: z.string()}),
})

export type ReplyRequest = z.infer<typeof ReplyRequestSchema>

/** Where a Provider session stands: the session, and a message inside it. */
export const SessionRefSchema = z.strictObject({
  sessionId: z.string(),
  messageId: z.string().nullable(),
})

export type SessionRef = z.infer<typeof SessionRefSchema>

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
  listModels(): Promise<Model[]>
  readUsage(): Promise<Usage>
  /** Ends with `RUN_FINISHED`, including after `stop`. */
  startReply(request: ReplyRequest): AsyncIterable<ReplyEvent>
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
])

export type HostCommand = z.infer<typeof HostCommandSchema>

export const HostReadyMessage = z.strictObject({
  type: z.literal('HOST_READY'),
  models: z.array(ModelSchema).min(1),
})

/** Provider host → main. */
export const HostMessageSchema = z.discriminatedUnion('type', [
  HostReadyMessage,
  ReplyEventSchema,
])

export type HostMessage = z.infer<typeof HostMessageSchema>

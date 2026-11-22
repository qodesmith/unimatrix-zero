import {AttachmentSchema} from '#modules/attachments/main'
import {ProviderIdSchema} from '#modules/providers/main'
import {z} from 'zod'

export const PromptSchema = z.strictObject({
  id: z.uuid(),
  treeId: z.uuid(),
  parentReplyId: z.uuid().nullable(),
  text: z.string(),
  /** In the order they were attached. */
  attachments: z.array(AttachmentSchema),
  createdAt: z.iso.datetime(),
})

export type Prompt = z.infer<typeof PromptSchema>

export const TextPartSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string(),
})

export const ToolCallPartSchema = z.strictObject({
  type: z.literal('tool-call'),
  toolCallId: z.string(),
  toolName: z.string(),
  /** The arguments as the Provider streamed them, usually JSON. */
  args: z.string(),
  result: z
    .strictObject({content: z.string(), isError: z.boolean()})
    .nullable(),
})

/** In the order it happened. */
export const ReplyPartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  ToolCallPartSchema,
])

export type ReplyPart = z.infer<typeof ReplyPartSchema>

/**
 * `interrupted`: the app quit while the Reply was streaming; set at the next
 * launch, and from then on like `stopped`.
 */
export const ReplyStatusSchema = z.enum([
  'streaming',
  'complete',
  'stopped',
  'failed',
  'interrupted',
])

export type ReplyStatus = z.infer<typeof ReplyStatusSchema>

const FinishedStatusSchema = ReplyStatusSchema.exclude(['streaming'])

export const RunFailureSchema = z.strictObject({
  code: z.enum([
    'connection-lost',
    'limit-reached',
    'program-crashed',
    'disk-full',
    'host-crashed',
    'host-unreachable',
    'driver-error',
    'provider-error',
    'too-long',
    'needs-app-update',
    'fake-failure',
  ]),
  message: z.string(),
  /** For `limit-reached`, when the limit lifts, if the Provider said. */
  resetsAt: z.iso.datetime().optional(),
  /**
   * For `too-long`, when the Provider caps one Prompt's text: the characters
   * it counted and its cap. Neither is set when the Context window was full.
   */
  promptChars: z.number().int().nonnegative().optional(),
  maxPromptChars: z.number().int().nonnegative().optional(),
})

export type RunFailure = z.infer<typeof RunFailureSchema>

/** A file whose contents differ between a Reply's Snapshot and its parent's. */
export const ChangedFileSchema = z.strictObject({
  /** Inside the Tree's files, with `/` between parts. */
  path: z.string().min(1),
  change: z.enum(['created', 'edited', 'deleted']),
  /** In bytes, as the Reply left it; null once deleted. */
  size: z.number().int().nonnegative().nullable(),
})

export type ChangedFile = z.infer<typeof ChangedFileSchema>

export const ReplyProgressSchema = z.strictObject({
  status: ReplyStatusSchema,
  content: z.array(ReplyPartSchema),
  contextSize: z.number().int().nonnegative().nullable(),
  contextWindow: z.number().int().positive().nullable(),
  failure: RunFailureSchema.nullable(),
  compacted: z.boolean(),
  /** Its session was rebuilt from the Thread. */
  rebuilt: z.boolean(),
})

export type ReplyProgress = z.infer<typeof ReplyProgressSchema>

export const ReplySchema = z.strictObject({
  ...ReplyProgressSchema.shape,
  id: z.uuid(),
  treeId: z.uuid(),
  promptId: z.uuid(),
  provider: ProviderIdSchema,
  model: z.string(),
  /** Empty until the Reply has finished. */
  files: z.array(ChangedFileSchema),
  createdAt: z.iso.datetime(),
})

export type Reply = z.infer<typeof ReplySchema>

export const StreamingReplySchema = z.strictObject({
  ...ReplyProgressSchema.shape,
  treeId: z.uuid(),
  replyId: z.uuid(),
})

export type StreamingReply = z.infer<typeof StreamingReplySchema>

const replyIds = {
  treeId: z.uuid(),
  replyId: z.uuid(),
}

const replyEvent = {
  ...replyIds,
  subagentId: z.string().optional(),
}

export const RunStartedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('RUN_STARTED'),
})

export const TextDeltaEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('TEXT_DELTA'),
  delta: z.string(),
})

/** A re-sent stream: the text so far of the current text part, replaced. */
export const TextReplaceEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('TEXT_REPLACE'),
  text: z.string(),
})

/**
 * A re-sent stream that threw a tool call away: the content cut back to before
 * that call, with the text part before it replaced, or dropped when empty.
 */
export const ContentCutBackEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('CONTENT_CUT_BACK'),
  toolCallId: z.string(),
  text: z.string(),
})

/** Display only: thinking is never stored. */
export const ReasoningDeltaEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('REASONING_DELTA'),
  delta: z.string(),
})

export const ToolCallStartEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('TOOL_CALL_START'),
  toolCallId: z.string(),
  toolName: z.string(),
})

export const ToolCallArgsEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('TOOL_CALL_ARGS'),
  toolCallId: z.string(),
  delta: z.string(),
})

export const ToolCallEndEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('TOOL_CALL_END'),
  toolCallId: z.string(),
})

export const ToolResultEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('TOOL_RESULT'),
  toolCallId: z.string(),
  content: z.string(),
  isError: z.boolean(),
})

export const ApprovalAnswerSchema = z.enum([
  'allow-once',
  'always-allow',
  'deny',
])

export type ApprovalAnswer = z.infer<typeof ApprovalAnswerSchema>

export const ApprovalRequestedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('APPROVAL_REQUESTED'),
  approvalId: z.string(),
  toolCallId: z.string().optional(),
  summary: z.string(),
})

export const ApprovalResolvedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('APPROVAL_RESOLVED'),
  approvalId: z.string(),
  answer: ApprovalAnswerSchema,
})

export const SubagentStartedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('SUBAGENT_STARTED'),
  subagentId: z.string(),
  description: z.string(),
})

export const SubagentFinishedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('SUBAGENT_FINISHED'),
  subagentId: z.string(),
  status: FinishedStatusSchema,
})

/** Sent after the Reply's `RUN_FINISHED`, when the Snapshot is taken. */
export const FilesChangedEvent = z.strictObject({
  ...replyIds,
  type: z.literal('FILES_CHANGED'),
  files: z.array(ChangedFileSchema).min(1),
})

const tokenCount = z.number().int().nonnegative()

export const TokensEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('TOKENS'),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  /** As the Provider reports it, never summed from Turns. */
  contextSize: tokenCount,
  contextWindow: z.number().int().positive().optional(),
})

export const ContextCompactedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('CONTEXT_COMPACTED'),
  sessionId: z.string(),
  /** Claude's boundary entry in that session; Codex reports none. */
  boundaryId: z.string().nullable(),
})

export const SessionRebuiltEvent = z.strictObject({
  ...replyIds,
  type: z.literal('SESSION_REBUILT'),
})

/**
 * Display only: the vendor program is retrying a request. Its next content
 * says the retry went through, since nothing else does.
 */
export const ReconnectingEvent = z.strictObject({
  ...replyIds,
  type: z.literal('RECONNECTING'),
  /** The server answered with a 429 or a 529, so the connection is fine. */
  busy: z.boolean(),
})

/** Ends the whole Reply; a Subagent ends with SUBAGENT_FINISHED. */
export const RunFinishedEvent = z.strictObject({
  ...replyIds,
  type: z.literal('RUN_FINISHED'),
  status: FinishedStatusSchema,
  failure: RunFailureSchema.optional(),
  /** Claude reports it only at the end; Codex with every usage report. */
  contextWindow: z.number().int().positive().optional(),
})

export const ReplyEventSchema = z.discriminatedUnion('type', [
  RunStartedEvent,
  TextDeltaEvent,
  TextReplaceEvent,
  ContentCutBackEvent,
  ReasoningDeltaEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolResultEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  SubagentStartedEvent,
  SubagentFinishedEvent,
  TokensEvent,
  ContextCompactedEvent,
  SessionRebuiltEvent,
  ReconnectingEvent,
  RunFinishedEvent,
])

export type ReplyEvent = z.infer<typeof ReplyEventSchema>

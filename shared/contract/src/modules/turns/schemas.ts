import {ProviderIdSchema} from '#modules/providers/main'
import {z} from 'zod'

export const PromptSchema = z.strictObject({
  id: z.uuid(),
  treeId: z.uuid(),
  /** Null for the root Prompt. */
  parentReplyId: z.uuid().nullable(),
  text: z.string(),
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

/** One provider-neutral piece of a Reply, in the order it happened. */
export const ReplyPartSchema = z.discriminatedUnion('type', [
  TextPartSchema,
  ToolCallPartSchema,
])

export type ReplyPart = z.infer<typeof ReplyPartSchema>

export const ReplyStatusSchema = z.enum([
  'streaming',
  'complete',
  'stopped',
  'failed',
])

export type ReplyStatus = z.infer<typeof ReplyStatusSchema>

const FinishedStatusSchema = ReplyStatusSchema.exclude(['streaming'])

/** Why a Reply failed, as the Provider host or main tells it. */
export const RunFailureSchema = z.strictObject({
  code: z.enum([
    'host-crashed',
    'host-unreachable',
    'driver-error',
    'provider-error',
    'fake-failure',
  ]),
  message: z.string(),
})

export type RunFailure = z.infer<typeof RunFailureSchema>

/** The part of a Reply that changes while it streams. */
export const ReplyProgressSchema = z.strictObject({
  status: ReplyStatusSchema,
  content: z.array(ReplyPartSchema),
  contextSize: z.number().int().nonnegative().nullable(),
  contextWindow: z.number().int().positive().nullable(),
})

export type ReplyProgress = z.infer<typeof ReplyProgressSchema>

export const ReplySchema = z.strictObject({
  ...ReplyProgressSchema.shape,
  id: z.uuid(),
  treeId: z.uuid(),
  promptId: z.uuid(),
  provider: ProviderIdSchema,
  model: z.string(),
  createdAt: z.iso.datetime(),
})

export type Reply = z.infer<typeof ReplySchema>

/** A Reply being written, as the window last displayed it. */
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
  /** Set when a Subagent of the Reply did it. */
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

export const FilesChangedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('FILES_CHANGED'),
  paths: z.array(z.string()),
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
  ReasoningDeltaEvent,
  ToolCallStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolResultEvent,
  ApprovalRequestedEvent,
  ApprovalResolvedEvent,
  SubagentStartedEvent,
  SubagentFinishedEvent,
  FilesChangedEvent,
  TokensEvent,
  ContextCompactedEvent,
  RunFinishedEvent,
])

export type ReplyEvent = z.infer<typeof ReplyEventSchema>

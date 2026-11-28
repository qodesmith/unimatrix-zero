import {AttachmentSchema} from '#modules/attachments/main'
import {ProviderIdSchema} from '#modules/providers/main'
import {z} from 'zod'

export const PromptSchema = z.strictObject({
  id: z.uuid(),
  treeId: z.uuid(),
  parentReplyId: z.uuid().nullable(),
  text: z.string(),
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
  args: z.string(),
  result: z
    .strictObject({content: z.string(), isError: z.boolean()})
    .nullable(),
})

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
  resetsAt: z.iso.datetime().optional(),
  promptChars: z.number().int().nonnegative().optional(),
  maxPromptChars: z.number().int().nonnegative().optional(),
})

export type RunFailure = z.infer<typeof RunFailureSchema>

export const ChangedFileSchema = z.strictObject({
  path: z.string().min(1),
  change: z.enum(['created', 'edited', 'deleted']),
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
  systemPromptId: z.uuid(),
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

export const TextReplaceEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('TEXT_REPLACE'),
  text: z.string(),
})

export const ContentCutBackEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('CONTENT_CUT_BACK'),
  toolCallId: z.string(),
  text: z.string(),
})

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

export const ApprovalActionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('edit'),
    paths: z.array(z.string().min(1)).min(1),
    inTreeFiles: z.boolean(),
  }),
  z.strictObject({
    kind: z.literal('command'),
    command: z.string(),
    outsideSandbox: z.literal(true).optional(),
    credentialsDenied: z.literal(true).optional(),
  }),
  z.strictObject({
    kind: z.literal('host'),
    host: z.string().min(1),
    fromCommand: z.literal(true).optional(),
  }),
  z.strictObject({
    kind: z.literal('mcp-tool'),
    server: z.string(),
    tool: z.string(),
  }),
  z.strictObject({kind: z.literal('tool'), name: z.string().min(1)}),
])

export type ApprovalAction = z.infer<typeof ApprovalActionSchema>

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
  action: ApprovalActionSchema,
})

export const ApprovalResolvedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('APPROVAL_RESOLVED'),
  approvalId: z.string(),
  answer: ApprovalAnswerSchema,
})

export const ReviewStartedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('REVIEW_STARTED'),
  reviewId: z.string(),
  toolCallId: z.string().optional(),
  action: ApprovalActionSchema,
})

export const ReviewFinishedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('REVIEW_FINISHED'),
  reviewId: z.string(),
  decision: z.enum(['approved', 'declined', 'unanswered']),
  reason: z.string().nullable(),
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
  contextSize: tokenCount,
  contextWindow: z.number().int().positive().optional(),
})

export const ContextCompactedEvent = z.strictObject({
  ...replyEvent,
  type: z.literal('CONTEXT_COMPACTED'),
  sessionId: z.string(),
  boundaryId: z.string().nullable(),
})

export const SessionRebuiltEvent = z.strictObject({
  ...replyIds,
  type: z.literal('SESSION_REBUILT'),
})

export const ReconnectingEvent = z.strictObject({
  ...replyIds,
  type: z.literal('RECONNECTING'),
  busy: z.boolean(),
})

export const RunFinishedEvent = z.strictObject({
  ...replyIds,
  type: z.literal('RUN_FINISHED'),
  status: FinishedStatusSchema,
  failure: RunFailureSchema.optional(),
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
  ReviewStartedEvent,
  ReviewFinishedEvent,
  SubagentStartedEvent,
  SubagentFinishedEvent,
  TokensEvent,
  ContextCompactedEvent,
  SessionRebuiltEvent,
  ReconnectingEvent,
  RunFinishedEvent,
])

export type ReplyEvent = z.infer<typeof ReplyEventSchema>

import type {ClientRequest} from './protocol/ClientRequest'
import type {RequestId} from './protocol/RequestId'
import type {ServerNotification} from './protocol/ServerNotification'
import type {ServerRequest} from './protocol/ServerRequest'
import type {Account} from './protocol/v2/Account'
import type {AccountLoginCompletedNotification} from './protocol/v2/AccountLoginCompletedNotification'
import type {AgentMessageDeltaNotification} from './protocol/v2/AgentMessageDeltaNotification'
import type {CodexErrorInfo} from './protocol/v2/CodexErrorInfo'
import type {CommandAction} from './protocol/v2/CommandAction'
import type {CommandExecutionRequestApprovalParams} from './protocol/v2/CommandExecutionRequestApprovalParams'
import type {CommandExecutionRequestApprovalResponse} from './protocol/v2/CommandExecutionRequestApprovalResponse'
import type {ErrorNotification} from './protocol/v2/ErrorNotification'
import type {FileChangeRequestApprovalParams} from './protocol/v2/FileChangeRequestApprovalParams'
import type {FileChangeRequestApprovalResponse} from './protocol/v2/FileChangeRequestApprovalResponse'
import type {LoginAccountResponse} from './protocol/v2/LoginAccountResponse'
import type {McpServerElicitationRequestParams} from './protocol/v2/McpServerElicitationRequestParams'
import type {McpServerElicitationRequestResponse} from './protocol/v2/McpServerElicitationRequestResponse'
import type {Model as CodexModel} from './protocol/v2/Model'
import type {ModelListResponse} from './protocol/v2/ModelListResponse'
import type {PatchChangeKind} from './protocol/v2/PatchChangeKind'
import type {RateLimitWindow} from './protocol/v2/RateLimitWindow'
import type {ServerRequestResolvedNotification} from './protocol/v2/ServerRequestResolvedNotification'
import type {Thread} from './protocol/v2/Thread'
import type {ThreadItem} from './protocol/v2/ThreadItem'
import type {ThreadTokenUsage} from './protocol/v2/ThreadTokenUsage'
import type {ThreadTurnsListResponse} from './protocol/v2/ThreadTurnsListResponse'
import type {TokenUsageBreakdown} from './protocol/v2/TokenUsageBreakdown'
import type {Turn} from './protocol/v2/Turn'
import type {TurnError} from './protocol/v2/TurnError'

import {RefusalSchema} from '#modules/failures/main'
import {z} from 'zod'

// Each schema `satisfies` its generated type, so a Codex bump fails typecheck.

const ThreadSchema = z.looseObject({
  id: z.string(),
  path: z.string().nullable(),
  forkedFromId: z.string().nullable(),
}) satisfies z.ZodType<Pick<Thread, 'id' | 'path' | 'forkedFromId'>>

const TurnErrorSchema = z.looseObject({
  message: z.string(),
  codexErrorInfo: z
    .union([z.string(), z.looseObject({})])
    .nullable()
    .optional(),
}) satisfies z.ZodType<
  Pick<TurnError, 'message'> & Partial<Pick<TurnError, 'codexErrorInfo'>>
>

type HttpStatusVariant = Pick<
  Extract<
    CodexErrorInfo,
    {responseStreamDisconnected: unknown}
  >['responseStreamDisconnected'],
  'httpStatusCode'
>

const HttpStatusSchema = z
  .record(
    z.string(),
    z.looseObject({
      httpStatusCode: z.number().nullable(),
    }) satisfies z.ZodType<HttpStatusVariant>
  )
  .transform(variant => Object.values(variant).at(0)?.httpStatusCode ?? null)

const RetryErrorSchema = TurnErrorSchema.transform(error => ({
  ...error,
  httpStatusCode: HttpStatusSchema.safeParse(error.codexErrorInfo).data ?? null,
}))

const TurnSchema = z.looseObject({
  id: z.string(),
  status: z.enum(['completed', 'interrupted', 'failed', 'inProgress']),
  error: TurnErrorSchema.nullable(),
}) satisfies z.ZodType<
  Pick<Turn, 'id' | 'status'> & {error: Pick<TurnError, 'message'> | null}
>

/** `planType` may be a plan this Codex doesn't know yet, so it stays a string. */
const AccountSchema = z.looseObject({
  type: z.string(),
  email: z.string().nullable().optional(),
  planType: z.string().optional(),
}) satisfies z.ZodType<
  Partial<Pick<Extract<Account, {type: 'chatgpt'}>, 'email'>>
>

const OpenedThreadSchema = z.looseObject({
  thread: ThreadSchema,
  model: z.string(),
})

export const RESPONSES = {
  initialize: z.looseObject({}),
  'account/login/start': z.looseObject({
    type: z.literal('chatgpt'),
    loginId: z.string(),
    authUrl: z.url(),
  }) satisfies z.ZodType<Extract<LoginAccountResponse, {type: 'chatgpt'}>>,
  'account/login/cancel': z.looseObject({}),
  'account/read': z.looseObject({
    account: AccountSchema.nullable(),
  }),
  'thread/start': OpenedThreadSchema,
  'thread/resume': OpenedThreadSchema,
  'thread/fork': OpenedThreadSchema,
  'thread/read': z.looseObject({thread: ThreadSchema}),
  'thread/unsubscribe': z.looseObject({}),
  'thread/revert': z.looseObject({thread: ThreadSchema}),
  'thread/inject_items': z.looseObject({}),
  'thread/turns/list': z.looseObject({
    data: z.array(z.looseObject({id: z.string()})),
    nextCursor: z.string().nullable(),
  }) satisfies z.ZodType<
    Pick<ThreadTurnsListResponse, 'nextCursor'> & {
      data: Pick<Turn, 'id'>[]
    }
  >,
  'model/list': z.looseObject({
    data: z.array(
      z.looseObject({
        model: z.string(),
        displayName: z.string(),
        isDefault: z.boolean(),
      })
    ),
    nextCursor: z.string().nullable(),
  }) satisfies z.ZodType<
    Pick<ModelListResponse, 'nextCursor'> & {
      data: Pick<CodexModel, 'model' | 'displayName' | 'isDefault'>[]
    }
  >,
  'turn/start': z.looseObject({turn: z.looseObject({id: z.string()})}),
  'turn/interrupt': z.looseObject({}),
} satisfies Partial<Record<ClientRequest['method'], z.ZodType>>

export type Method = keyof typeof RESPONSES

export type ParamsOf<M extends Method> = Extract<
  ClientRequest,
  {method: M}
>['params']

export type ResponseOf<M extends Method> = z.infer<(typeof RESPONSES)[M]>

const inTurn = {threadId: z.string(), turnId: z.string()}

const DeltaSchema = z.looseObject({...inTurn, delta: z.string()})

const LastUsageSchema = z.looseObject({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
}) satisfies z.ZodType<
  Pick<TokenUsageBreakdown, 'inputTokens' | 'outputTokens' | 'totalTokens'>
>

const ThreadTokenUsageSchema = z.looseObject({
  last: LastUsageSchema,
  // Unknown or malformed reads as absent, so the usage itself is never lost with it.
  modelContextWindow: z.number().nullable().catch(null),
}) satisfies z.ZodType<Pick<ThreadTokenUsage, 'modelContextWindow'>>

export const AgentMessageItemSchema = z.looseObject({
  type: z.literal('agentMessage'),
  id: z.string(),
  text: z.string(),
})

type ItemOf<T extends ThreadItem['type']> = Extract<ThreadItem, {type: T}>

const ToolStatusSchema = z.enum([
  'inProgress',
  'completed',
  'failed',
  'declined',
]) satisfies z.ZodType<ItemOf<'commandExecution'>['status']>

const CommandExecutionItemSchema = z.looseObject({
  type: z.literal('commandExecution'),
  id: z.string(),
  command: z.string(),
  cwd: z.string(),
  status: ToolStatusSchema,
  aggregatedOutput: z.string().nullable(),
  exitCode: z.number().nullable(),
}) satisfies z.ZodType<
  Pick<
    ItemOf<'commandExecution'>,
    | 'type'
    | 'id'
    | 'command'
    | 'cwd'
    | 'status'
    | 'aggregatedOutput'
    | 'exitCode'
  >
>

const FileChangeItemSchema = z.looseObject({
  type: z.literal('fileChange'),
  id: z.string(),
  changes: z.array(
    z.looseObject({
      path: z.string(),
      kind: z.looseObject({type: z.enum(['add', 'delete', 'update'])}),
      diff: z.string(),
    })
  ),
  status: ToolStatusSchema,
}) satisfies z.ZodType<
  Pick<ItemOf<'fileChange'>, 'type' | 'id' | 'status'> & {
    changes: (Pick<ItemOf<'fileChange'>['changes'][number], 'path' | 'diff'> & {
      kind: Pick<PatchChangeKind, 'type'>
    })[]
  }
>

export const ToolItemSchema = z.union([
  CommandExecutionItemSchema,
  FileChangeItemSchema,
])

export const McpToolCallItemSchema = z.looseObject({
  type: z.literal('mcpToolCall'),
  id: z.string(),
  server: z.string(),
  tool: z.string(),
}) satisfies z.ZodType<
  Pick<ItemOf<'mcpToolCall'>, 'type' | 'id' | 'server' | 'tool'>
>

const ItemSchema = z.union([
  AgentMessageItemSchema,
  ToolItemSchema,
  z.looseObject({type: z.string()}),
])

export type Item = z.infer<typeof ItemSchema>

export type ToolItem = z.infer<typeof ToolItemSchema>

/**
 * No `item/completed` comes for a compaction that fails or a hook stops, and
 * the `{id}`-only item can't tell one that installed nothing apart.
 */
export const CONTEXT_COMPACTION =
  'contextCompaction' satisfies ThreadItem['type']

const RateLimitWindowSchema = z.looseObject({
  usedPercent: z.number(),
  resetsAt: z.number().nullable(),
}) satisfies z.ZodType<Pick<RateLimitWindow, 'usedPercent' | 'resetsAt'>>

const RateLimitsSchema = z.looseObject({
  primary: RateLimitWindowSchema.nullable().catch(null),
  secondary: RateLimitWindowSchema.nullable().catch(null),
  // A value this Codex doesn't know yet still means a limit was reached.
  rateLimitReachedType: z.string().nullable().optional().catch(null),
})

export type RateLimits = z.infer<typeof RateLimitsSchema>

function notification<
  M extends ServerNotification['method'],
  P extends z.ZodType,
>(method: M, params: P) {
  return z.looseObject({method: z.literal(method), params})
}

export const NotificationSchema = z.discriminatedUnion('method', [
  notification(
    'account/login/completed',
    z.looseObject({
      loginId: z.string().nullable(),
      success: z.boolean(),
      error: z.string().nullable(),
    }) satisfies z.ZodType<
      Pick<AccountLoginCompletedNotification, 'loginId' | 'success' | 'error'>
    >
  ),
  notification(
    'item/agentMessage/delta',
    z.looseObject({
      ...inTurn,
      itemId: z.string(),
      delta: z.string(),
    }) satisfies z.ZodType<AgentMessageDeltaNotification>
  ),
  notification(
    'account/rateLimits/updated',
    z.looseObject({rateLimits: RateLimitsSchema})
  ),
  notification('item/reasoning/summaryTextDelta', DeltaSchema),
  notification('item/reasoning/textDelta', DeltaSchema),
  notification('item/started', z.looseObject({...inTurn, item: ItemSchema})),
  notification('item/completed', z.looseObject({...inTurn, item: ItemSchema})),
  notification(
    'thread/tokenUsage/updated',
    z.looseObject({
      ...inTurn,
      tokenUsage: ThreadTokenUsageSchema,
    })
  ),
  // One per retry of a failed request. When Codex gives up, the failure comes
  // with `turn/completed`.
  notification(
    'error',
    z.looseObject({
      ...inTurn,
      willRetry: z.boolean(),
      error: RetryErrorSchema,
    }) satisfies z.ZodType<
      Pick<ErrorNotification, 'threadId' | 'turnId' | 'willRetry'> & {
        error: Pick<TurnError, 'message'>
      }
    >
  ),
  notification(
    'turn/completed',
    z.looseObject({threadId: z.string(), turn: TurnSchema})
  ),
  // Codex dropped the request unanswered, as on `turn/interrupt`.
  notification(
    'serverRequest/resolved',
    z.looseObject({
      threadId: z.string(),
      requestId: z.union([z.string(), z.number()]),
    }) satisfies z.ZodType<ServerRequestResolvedNotification>
  ),
])

export type Notification = z.infer<typeof NotificationSchema>

const RequestIdSchema = z.union([
  z.string(),
  z.number(),
]) satisfies z.ZodType<RequestId>

export const ServerRequestSchema = z.looseObject({
  id: RequestIdSchema,
  method: z.string(),
})

function serverRequest<M extends ServerRequest['method'], P extends z.ZodType>(
  method: M,
  params: P
) {
  return z.looseObject({
    id: RequestIdSchema,
    method: z.literal(method),
    params,
  })
}

/** A string, so a kind a later Codex adds reads as no read. */
const CommandActionSchema = z.looseObject({type: z.string()})

/** What Codex parsed a command into; these only read. */
export const READ_ACTIONS: readonly string[] = [
  'read',
  'listFiles',
  'search',
] satisfies CommandAction['type'][]

/**
 * The server requests that ask before a tool runs. Any other, or an MCP
 * elicitation that isn't a tool's approval, is refused.
 */
export const ApprovalRequestSchema = z.discriminatedUnion('method', [
  serverRequest(
    'item/commandExecution/requestApproval',
    z.looseObject({
      ...inTurn,
      itemId: z.string(),
      command: z.string().nullable().optional(),
      commandActions: z.array(CommandActionSchema).nullable().optional(),
      networkApprovalContext: z
        .looseObject({host: z.string().min(1)})
        .nullable()
        .optional(),
    }) satisfies z.ZodType<
      Pick<
        CommandExecutionRequestApprovalParams,
        'threadId' | 'turnId' | 'itemId'
      > &
        Partial<Pick<CommandExecutionRequestApprovalParams, 'command'>>
    >
  ),
  serverRequest(
    'item/fileChange/requestApproval',
    z.looseObject({
      ...inTurn,
      itemId: z.string(),
    }) satisfies z.ZodType<
      Pick<FileChangeRequestApprovalParams, 'threadId' | 'turnId' | 'itemId'>
    >
  ),
  serverRequest(
    'mcpServer/elicitation/request',
    z.looseObject({
      threadId: z.string(),
      turnId: z.string().nullable(),
      serverName: z.string(),
      _meta: z.looseObject({codex_approval_kind: z.literal('mcp_tool_call')}),
    }) satisfies z.ZodType<
      Pick<
        McpServerElicitationRequestParams,
        'threadId' | 'turnId' | 'serverName'
      >
    >
  ),
])

export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>

/** Never `acceptForSession`: the app keeps the Tree's grants itself. */
export function approvalAnswer(request: ApprovalRequest, allowed: boolean) {
  if (request.method === 'mcpServer/elicitation/request') {
    return {
      action: allowed ? 'accept' : 'decline',
      content: null,
      _meta: null,
    } satisfies McpServerElicitationRequestResponse
  }

  const decision = allowed ? 'accept' : 'decline'

  return {decision} satisfies CommandExecutionRequestApprovalResponse &
    FileChangeRequestApprovalResponse
}

export const AnswerSchema = z.looseObject({
  id: z.number(),
  result: z.unknown().optional(),
  error: z
    .looseObject({
      message: z.string(),
      data: RefusalSchema.optional().catch(undefined),
    })
    .optional(),
})

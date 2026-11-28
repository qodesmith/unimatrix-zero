import type {ServerRequest} from './protocol/ServerRequest'
import type {CommandAction} from './protocol/v2/CommandAction'
import type {CommandExecutionRequestApprovalParams} from './protocol/v2/CommandExecutionRequestApprovalParams'
import type {CommandExecutionRequestApprovalResponse} from './protocol/v2/CommandExecutionRequestApprovalResponse'
import type {FileChangeRequestApprovalParams} from './protocol/v2/FileChangeRequestApprovalParams'
import type {FileChangeRequestApprovalResponse} from './protocol/v2/FileChangeRequestApprovalResponse'
import type {McpServerElicitationRequestParams} from './protocol/v2/McpServerElicitationRequestParams'
import type {McpServerElicitationRequestResponse} from './protocol/v2/McpServerElicitationRequestResponse'

import {z} from 'zod'

import {RequestIdSchema, inTurn} from './wire'

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

export const READ_ACTIONS: readonly string[] = [
  'read',
  'listFiles',
  'search',
] satisfies CommandAction['type'][]

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

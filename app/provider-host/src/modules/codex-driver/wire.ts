import type {ClientRequest} from './protocol/ClientRequest'
import type {ServerNotification} from './protocol/ServerNotification'
import type {Account} from './protocol/v2/Account'
import type {AccountLoginCompletedNotification} from './protocol/v2/AccountLoginCompletedNotification'
import type {AgentMessageDeltaNotification} from './protocol/v2/AgentMessageDeltaNotification'
import type {LoginAccountResponse} from './protocol/v2/LoginAccountResponse'
import type {RateLimitWindow} from './protocol/v2/RateLimitWindow'
import type {Thread} from './protocol/v2/Thread'
import type {ThreadTokenUsage} from './protocol/v2/ThreadTokenUsage'
import type {ThreadTurnsListResponse} from './protocol/v2/ThreadTurnsListResponse'
import type {TokenUsageBreakdown} from './protocol/v2/TokenUsageBreakdown'
import type {Turn} from './protocol/v2/Turn'
import type {TurnError} from './protocol/v2/TurnError'

import {z} from 'zod'

// Each schema `satisfies` the generated type it reads from, so a Codex bump
// that changes one of those fields fails typecheck here.

const ThreadSchema = z.looseObject({
  id: z.string(),
  path: z.string().nullable(),
  forkedFromId: z.string().nullable(),
}) satisfies z.ZodType<Pick<Thread, 'id' | 'path' | 'forkedFromId'>>

const TurnErrorSchema = z.looseObject({
  message: z.string(),
}) satisfies z.ZodType<Pick<TurnError, 'message'>>

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
  'thread/revert': z.looseObject({thread: ThreadSchema}),
  'thread/turns/list': z.looseObject({
    data: z.array(z.looseObject({id: z.string()})),
    nextCursor: z.string().nullable(),
  }) satisfies z.ZodType<
    Pick<ThreadTurnsListResponse, 'nextCursor'> & {
      data: Pick<Turn, 'id'>[]
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

const RateLimitWindowSchema = z.looseObject({
  usedPercent: z.number(),
  resetsAt: z.number().nullable(),
}) satisfies z.ZodType<Pick<RateLimitWindow, 'usedPercent' | 'resetsAt'>>

const RateLimitsSchema = z.looseObject({
  primary: RateLimitWindowSchema.nullable().catch(null),
  secondary: RateLimitWindowSchema.nullable().catch(null),
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
  notification(
    'item/completed',
    z.looseObject({
      ...inTurn,
      item: z.union([
        AgentMessageItemSchema,
        z.looseObject({type: z.string()}),
      ]),
    })
  ),
  notification(
    'thread/tokenUsage/updated',
    z.looseObject({
      ...inTurn,
      tokenUsage: ThreadTokenUsageSchema,
    })
  ),
  notification(
    'turn/completed',
    z.looseObject({threadId: z.string(), turn: TurnSchema})
  ),
])

export type Notification = z.infer<typeof NotificationSchema>

export const ServerRequestSchema = z.looseObject({
  id: z.union([z.string(), z.number()]),
  method: z.string(),
})

export const AnswerSchema = z.looseObject({
  id: z.number(),
  result: z.unknown().optional(),
  error: z.looseObject({message: z.string()}).optional(),
})

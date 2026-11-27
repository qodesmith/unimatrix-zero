import fs from 'node:fs'
import path from 'node:path'
import {z} from 'zod'

import {CODEX_HOME_STAND_IN, RECORDINGS} from './replay'

const LineSchema = z.looseObject({
  kind: z.string(),
  message: z.looseObject({}).optional(),
})

const RequestSchema = z.looseObject({id: z.number(), method: z.string()})
const ResultSchema = z.looseObject({id: z.number(), result: z.looseObject({})})

const NotificationSchema = z.looseObject({
  method: z.string(),
  params: z.looseObject({turnId: z.string().optional()}),
})

const ThreadResultSchema = z.looseObject({
  thread: z.looseObject({id: z.string(), path: z.string()}),
})

const TurnResultSchema = z.looseObject({
  turn: z.looseObject({id: z.string()}),
})

const DeltaSchema = z.looseObject({delta: z.string()})

const CompletedSchema = z.looseObject({
  item: z.looseObject({type: z.string(), text: z.string().optional()}),
})

const TokenUsageSchema = z.looseObject({
  tokenUsage: z.looseObject({
    last: z.looseObject({totalTokens: z.number()}),
    modelContextWindow: z.number().nullable(),
  }),
})

const ApprovalRequestSchema = z.looseObject({itemId: z.string()})

const CommandRequestSchema = z.looseObject({
  itemId: z.string(),
  command: z.string(),
  commandActions: z.tuple([z.looseObject({command: z.string()})]),
})

const RateLimitsSchema = z.looseObject({
  rateLimits: z.looseObject({
    primary: z.looseObject({resetsAt: z.number()}),
  }),
})

type ThreadMethod =
  | 'thread/start'
  | 'thread/resume'
  | 'thread/fork'
  | 'thread/revert'

/** What a live run made, picked from its recording by place in the protocol. */
export function readRecording(name: string) {
  const lines = fs
    .readFileSync(path.join(RECORDINGS, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => LineSchema.parse(JSON.parse(line)))

  function nth<T>(found: T[], at: number, what: string) {
    const value = found[at]

    if (value === undefined) throw new Error(`${name} has no ${what} ${at}`)

    return value
  }

  function resultsOf(method: string) {
    return lines.flatMap(({kind, message}, at) => {
      const request = RequestSchema.safeParse(message).data

      if (kind !== 'in' || request?.method !== method) return []

      const answer = lines
        .slice(at + 1)
        .find(
          line =>
            line.kind === 'out' &&
            ResultSchema.safeParse(line.message).data?.id === request.id
        )

      const parsed = ResultSchema.safeParse(answer?.message)

      return parsed.success ? [parsed.data.result] : []
    })
  }

  function sent(method: string, withId: boolean) {
    return lines.flatMap(({kind, message}) => {
      const parsed = NotificationSchema.safeParse(message)

      return kind === 'out' &&
        parsed.data?.method === method &&
        withId === (message !== undefined && 'id' in message)
        ? [parsed.data.params]
        : []
    })
  }

  const turnIds = resultsOf('turn/start').map(
    result => TurnResultSchema.parse(result).turn.id
  )

  function turn(at: number) {
    const id = nth(turnIds, at, 'turn/start result')

    function ofTurn(method: string) {
      return sent(method, false).filter(params => params.turnId === id)
    }

    const usage = ofTurn('thread/tokenUsage/updated').map(
      params => TokenUsageSchema.parse(params).tokenUsage
    )

    const messages = ofTurn('item/completed').flatMap(params => {
      const {item} = CompletedSchema.parse(params)

      return item.type === 'agentMessage' ? [item.text ?? ''] : []
    })

    return {
      id,
      messages,
      text: messages.join(''),
      deltas: ofTurn('item/agentMessage/delta').map(
        params => DeltaSchema.parse(params).delta
      ),
      contextSizes: usage.map(each => each.last.totalTokens),
      contextWindow: usage.at(-1)?.modelContextWindow ?? null,
    }
  }

  return {
    /** `rollout` is the thread's path under `CODEX_HOME`, as the app keeps it. */
    thread(method: ThreadMethod, at = 0) {
      const {thread} = ThreadResultSchema.parse(
        nth(resultsOf(method), at, `${method} result`)
      )

      return {
        id: thread.id,
        rollout: path.posix.relative(CODEX_HOME_STAND_IN, thread.path),
      }
    },
    turn,
    approvalRequest(method: string, at = 0) {
      return ApprovalRequestSchema.parse(nth(sent(method, true), at, method))
    },
    /** `parsed` is the command Codex read out of the shell `command` runs in. */
    commandRequest(at = 0) {
      const method = 'item/commandExecution/requestApproval'

      const {itemId, command, commandActions} = CommandRequestSchema.parse(
        nth(sent(method, true), at, method)
      )

      return {itemId, command, parsed: commandActions[0].command}
    },
    rateLimits(at = 0) {
      return RateLimitsSchema.parse(
        nth(sent('account/rateLimits/updated', false), at, 'rate limits')
      ).rateLimits
    },
  }
}

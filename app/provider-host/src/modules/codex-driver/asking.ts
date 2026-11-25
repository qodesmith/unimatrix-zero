import type {ApprovalEvent, Approvals, Asking} from '#modules/approvals/main'
import type {AppServer} from './app-server'
import type {ApprovalRequest, Item, Notification} from './wire'
import type {ReplyRequest} from '@uz/contract/host'

import {isInTreeFolder} from '#modules/tree-folder/main'

import {
  McpToolCallItemSchema,
  READ_ACTIONS,
  ToolItemSchema,
  approvalAnswer,
} from './wire'

/** What a turn reads, in the order it happened. */
export type Received =
  | Notification
  | {method: 'exited'}
  | {method: 'approval'; request: ApprovalRequest}
  | {method: 'shown'; event: ApprovalEvent}

type CommandRequest = Extract<
  ApprovalRequest,
  {method: 'item/commandExecution/requestApproval'}
>['params']

type Card = Omit<Asking, 'signal'>

type Taken = Extract<Received, {method: 'approval' | 'serverRequest/resolved'}>

interface TurnAskingOptions {
  server: Pick<AppServer, 'respond' | 'takeApprovals'>
  approvals: Approvals
  request: ReplyRequest
  threadId: string
  push: (received: Received) => void
}

/** A command Codex parsed into reads alone runs without a card. */
function onlyReads({commandActions}: CommandRequest) {
  return (
    !!commandActions?.length &&
    commandActions.every(action => READ_ACTIONS.includes(action.type))
  )
}

function commandCard(params: CommandRequest): Card {
  const host = params.networkApprovalContext?.host

  return {
    action: host
      ? {kind: 'host', host}
      : {kind: 'command', command: params.command ?? ''},
  }
}

/**
 * Answers the approval requests of one turn's thread: a read at once, anything
 * else through the Reply's cards. Under full access it takes none, so each is
 * refused. `itemId` is the tool call's id.
 */
export function createTurnAsking({
  server,
  approvals,
  request,
  threadId,
  push,
}: TurnAskingOptions) {
  const toolCalls = new Set<string>()
  const changedPaths = new Map<string, string[]>()
  const mcpCalls = new Map<string, {server: string; tool: string}>()
  const waiting = new Map<ApprovalRequest['id'], AbortController>()

  const cards = approvals.forReply(
    {treeId: request.treeId, replyId: request.replyId, grants: request.grants},
    event => push({method: 'shown', event})
  )

  const untake =
    request.permissionMode === 'supervised'
      ? server.takeApprovals(approval => {
          if (approval.params.threadId !== threadId) return false

          push({method: 'approval', request: approval})

          return true
        })
      : () => undefined

  function linked(toolCallId: string) {
    return toolCalls.has(toolCallId) ? {toolCallId} : {}
  }

  function editCard(itemId: string): Card | null {
    const paths = changedPaths.get(itemId) ?? []
    const [first, ...rest] = paths

    if (first === undefined) return null

    return {
      action: {
        kind: 'edit',
        paths: [first, ...rest],
        inTreeFiles: paths.every(file =>
          isInTreeFolder(request.treeFolder, file)
        ),
      },
      ...linked(itemId),
    }
  }

  /** The elicitation names no call, so it's the oldest one of its server. */
  function mcpCard(serverName: string): Card | null {
    for (const [id, call] of mcpCalls) {
      if (call.server !== serverName) continue

      mcpCalls.delete(id)

      return {
        action: {kind: 'mcp-tool', server: call.server, tool: call.tool},
        ...linked(id),
      }
    }

    return null
  }

  /** Null: nothing to show on a card, so it's declined. */
  function cardOf(asked: ApprovalRequest): Card | null {
    switch (asked.method) {
      case 'item/commandExecution/requestApproval':
        return {...commandCard(asked.params), ...linked(asked.params.itemId)}
      case 'item/fileChange/requestApproval':
        return editCard(asked.params.itemId)
      case 'mcpServer/elicitation/request':
        return mcpCard(asked.params.serverName)
      default:
        return null
    }
  }

  /** Null: Codex dropped the request, so it wants no answer. */
  async function ask(asked: ApprovalRequest) {
    const card = cardOf(asked)

    if (!card) return false

    const dropped = new AbortController()
    waiting.set(asked.id, dropped)

    try {
      const allowed = await cards.ask({...card, signal: dropped.signal})

      return dropped.signal.aborted ? null : allowed
    } finally {
      waiting.delete(asked.id)
    }
  }

  async function answer(asked: ApprovalRequest) {
    const reads =
      asked.method === 'item/commandExecution/requestApproval' &&
      onlyReads(asked.params)

    const allowed = reads || (await ask(asked))

    if (allowed !== null)
      server.respond(asked.id, approvalAnswer(asked, allowed))
  }

  function started(item: Item) {
    const tool = ToolItemSchema.safeParse(item)

    if (tool.success) {
      toolCalls.add(tool.data.id)

      if (tool.data.type === 'fileChange') {
        changedPaths.set(
          tool.data.id,
          tool.data.changes.map(change => change.path)
        )
      }
    }

    const mcp = McpToolCallItemSchema.safeParse(item)

    if (mcp.success) {
      toolCalls.add(mcp.data.id)
      mcpCalls.set(mcp.data.id, {server: mcp.data.server, tool: mcp.data.tool})
    }
  }

  return {
    /**
     * True for an approval request or Codex dropping one, which it answers
     * without blocking, so the turn reads on while a card waits.
     */
    took(received: Received): received is Taken {
      if (received.method === 'approval') {
        void answer(received.request)

        return true
      }

      if (received.method !== 'serverRequest/resolved') return false

      waiting.get(received.params.requestId)?.abort()

      return true
    },

    /** The turn's own notifications, for what an approval request leaves out. */
    seen(notification: Notification) {
      if (notification.method === 'item/started') {
        started(notification.params.item)
      }

      if (notification.method === 'item/completed') {
        const mcp = McpToolCallItemSchema.safeParse(notification.params.item)

        if (mcp.success) mcpCalls.delete(mcp.data.id)
      }
    },

    /** A card still waiting once the turn ends is dropped. */
    close() {
      untake()

      for (const dropped of waiting.values()) dropped.abort()
    },
  }
}

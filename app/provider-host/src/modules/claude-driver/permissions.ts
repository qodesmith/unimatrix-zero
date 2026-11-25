import type {ReplyApprovals} from '#modules/approvals/main'
import type {CanUseTool, Options} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest} from '@uz/contract/host'
import type {ApprovalAction} from '@uz/contract/permissions'

import {isInTreeFolder} from '#modules/tree-folder/main'
import path from 'node:path'
import {z} from 'zod'

/** The Reply being written on a `claude`, whose callback is fixed at start. */
export interface SessionApprovals {
  current: ReplyApprovals | null
}

/** Reads never ask, in any mode: `default` asks for one outside `cwd`. */
const READS = 'Read|Glob|Grep'

const DENIED = 'The user denied this.'

/** What a card needs of a tool call's input; anything else is left out. */
const ToolInputSchema = z.object({
  file_path: z.string().min(1).optional().catch(undefined),
  notebook_path: z.string().min(1).optional().catch(undefined),
  command: z.string().optional().catch(undefined),
  url: z.string().optional().catch(undefined),
})

type ToolInput = z.infer<typeof ToolInputSchema>

const MCP_TOOL = /^mcp__(.+?)__(.+)$/

function editOf(filePath: string, treeFolder: string): ApprovalAction {
  const absolute = path.resolve(treeFolder, filePath)

  return {
    kind: 'edit',
    paths: [absolute],
    inTreeFiles: isInTreeFolder(treeFolder, absolute),
  }
}

function hostOf(url: string | undefined) {
  return url !== undefined && URL.canParse(url) ? new URL(url).hostname : null
}

/**
 * What a card asks about a tool call `claude` asks for, by Claude Code's tool
 * names.
 */
export function actionOf(
  toolName: string,
  input: ToolInput,
  treeFolder: string
): ApprovalAction {
  const {file_path: filePath, notebook_path: notebookPath, command} = input
  const host = toolName === 'WebFetch' ? hostOf(input.url) : null
  const [, server, tool] = MCP_TOOL.exec(toolName) ?? []

  if ((toolName === 'Write' || toolName === 'Edit') && filePath) {
    return editOf(filePath, treeFolder)
  }

  if (toolName === 'NotebookEdit' && notebookPath) {
    return editOf(notebookPath, treeFolder)
  }

  if (
    (toolName === 'Bash' || toolName === 'PowerShell') &&
    command !== undefined
  ) {
    return {kind: 'command', command}
  }

  if (host) return {kind: 'host', host}

  if (server && tool) return {kind: 'mcp-tool', server, tool}

  return {kind: 'tool', name: toolName}
}

/**
 * `claude`'s own suggestions are never passed back: one for a Write turns the
 * whole session to accepting edits.
 */
function askOn(asking: SessionApprovals, treeFolder: string): CanUseTool {
  return async (toolName, input, {signal, toolUseID, agentID}) => {
    const approvals = asking.current

    const allowed =
      approvals !== null &&
      (await approvals.ask({
        action: actionOf(toolName, ToolInputSchema.parse(input), treeFolder),
        // A Subagent's call is never shown, so its card sits at none.
        ...(agentID ? {subagentId: agentID} : {toolCallId: toolUseID}),
        signal,
      }))

    return allowed
      ? {behavior: 'allow', updatedInput: input}
      : {behavior: 'deny', message: DENIED}
  }
}

/** Full access asks nothing; Supervised asks the user through `asking`. */
export function permissionOptions(
  {permissionMode, treeFolder}: ReplyRequest,
  asking: SessionApprovals
): Options {
  if (permissionMode === 'full-access') {
    return {
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
    }
  }

  return {
    permissionMode: 'default',
    canUseTool: askOn(asking, treeFolder),
    // An allow here skips `canUseTool`.
    hooks: {
      PreToolUse: [
        {
          matcher: READS,
          hooks: [
            async () => ({
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: 'allow',
              },
            }),
          ],
        },
      ],
    },
  }
}

import type {ReplyApprovals} from '#modules/approvals/main'
import type {
  CanUseTool,
  Options,
  PreToolUseHookSpecificOutput,
  SandboxSettings,
} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest} from '@uz/contract/host'
import type {ApprovalAction} from '@uz/contract/permissions'

import {
  credentialFolders,
  hasSandbox,
  packageCaches,
} from '#modules/sandbox/main'
import {
  holdsEveryTree,
  isInAnotherTree,
  isInTreeFolder,
} from '#modules/tree-folder/main'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

/** The Reply being written on a `claude`, whose callback is fixed at start. */
export interface SessionApprovals {
  current: ReplyApprovals | null
}

/** Reads never ask, in any mode: `default` asks for one outside `cwd`. */
const READS = 'Read|Glob|Grep'

const DENIED = 'The user denied this.'

const ANOTHER_TREE = 'This path is in a folder that can’t be read from here.'

const ABOVE_THE_TREES =
  'This search covers folders that can’t be read from here. Search a narrower folder.'

/** What a card needs of a tool call's input; anything else is left out. */
const ToolInputSchema = z.object({
  file_path: z.string().min(1).optional().catch(undefined),
  /** The folder a Glob or a Grep searches. */
  path: z.string().min(1).optional().catch(undefined),
  pattern: z.string().min(1).optional().catch(undefined),
  notebook_path: z.string().min(1).optional().catch(undefined),
  command: z.string().optional().catch(undefined),
  url: z.string().optional().catch(undefined),
  /** The Sandbox blocked the command, and the Model asks to run it outside. */
  dangerouslyDisableSandbox: z.boolean().optional().catch(undefined),
  /** The host a sandboxed command wants to reach. */
  host: z.string().min(1).optional().catch(undefined),
})

type ToolInput = z.infer<typeof ToolInputSchema>

const MCP_TOOL = /^mcp__(.+?)__(.+)$/

/** `claude`'s prompt when a command inside the Sandbox opens a connection. */
const SANDBOX_NETWORK = 'SandboxNetworkAccess'

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

function hostIn(toolName: string, input: ToolInput) {
  if (toolName === SANDBOX_NETWORK) return input.host ?? null

  return toolName === 'WebFetch' ? hostOf(input.url) : null
}

export function actionOf(
  toolName: string,
  input: ToolInput,
  treeFolder: string
): ApprovalAction {
  const {file_path: filePath, notebook_path: notebookPath, command} = input
  const host = hostIn(toolName, input)
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
    return input.dangerouslyDisableSandbox
      ? {kind: 'command', command, outsideSandbox: true}
      : {kind: 'command', command}
  }

  if (host) return {kind: 'host', host}

  if (server && tool) return {kind: 'mcp-tool', server, tool}

  return {kind: 'tool', name: toolName}
}

/**
 * A Subagent's call is never shown, so its card sits at none. Nor does the
 * Sandbox's network prompt: its id names no tool call.
 */
function placeOf(toolName: string, toolUseID: string, agentID?: string) {
  if (agentID) return {subagentId: agentID}

  return toolName === SANDBOX_NETWORK ? {} : {toolCallId: toolUseID}
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
        ...placeOf(toolName, toolUseID, agentID),
        signal,
      }))

    return allowed
      ? {behavior: 'allow', updatedInput: input}
      : {behavior: 'deny', message: DENIED}
  }
}

const HookInputSchema = z.object({
  tool_name: z.string(),
  tool_input: ToolInputSchema,
})

/** A Glob's pattern may itself name a folder, from the one it searches. */
function readTargets(toolName: string, input: ToolInput, treeFolder: string) {
  const {file_path: filePath, path: folder, pattern} = input

  const globbed =
    toolName === 'Glob' && pattern
      ? [path.resolve(treeFolder, folder ?? '.', pattern)]
      : []

  return [filePath, folder, ...globbed].filter(target => target !== undefined)
}

const GLOB_CHARACTER = /[*?[{]/u

/** The deepest folder that holds every file `pattern` can match. */
function globRoot(searched: string, pattern: string) {
  const wildcardAt = pattern.search(GLOB_CHARACTER)

  return wildcardAt === -1
    ? path.resolve(searched, pattern)
    : path.dirname(path.resolve(searched, `${pattern.slice(0, wildcardAt)}_`))
}

/** The folders a Glob or a Grep walks down from; a Read walks none. */
function searchRoots(toolName: string, input: ToolInput, treeFolder: string) {
  const {path: folder, pattern} = input
  const searched = path.resolve(treeFolder, folder ?? '.')

  if (toolName === 'Grep') return [searched]

  return toolName === 'Glob' && pattern ? [globRoot(searched, pattern)] : []
}

function refusal(
  toolName: string,
  input: ToolInput,
  folders: Pick<ReplyRequest, 'treeFolder' | 'treesFolder'>
) {
  const {treeFolder} = folders

  if (
    searchRoots(toolName, input, treeFolder).some(root =>
      holdsEveryTree(folders, root)
    )
  ) {
    return ABOVE_THE_TREES
  }

  return readTargets(toolName, input, treeFolder).some(target =>
    isInAnotherTree(folders, target)
  )
    ? ANOTHER_TREE
    : null
}

/**
 * The Sandbox hides other Trees from commands only, and a Read deny rule for
 * their folder would hide this Tree's own, so the hook refuses them
 * (ADR 0018).
 */
export function readDecision(
  toolName: string,
  input: ToolInput,
  folders: Pick<ReplyRequest, 'treeFolder' | 'treesFolder'>
): Pick<
  PreToolUseHookSpecificOutput,
  'permissionDecision' | 'permissionDecisionReason'
> {
  const reason = refusal(toolName, input, folders)

  return reason === null
    ? {permissionDecision: 'allow'}
    : {permissionDecision: 'deny', permissionDecisionReason: reason}
}

/** Full access asks nothing; Supervised asks the user through `asking`. */
export function permissionOptions(
  request: ReplyRequest,
  asking: SessionApprovals
): Options {
  const {permissionMode, treeFolder} = request

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
            async input => {
              const {tool_name: toolName, tool_input: toolInput} =
                HookInputSchema.parse(input)

              return {
                hookSpecificOutput: {
                  hookEventName: 'PreToolUse',
                  ...readDecision(toolName, toolInput, request),
                },
              }
            },
          ],
        },
      ],
    },
  }
}

/**
 * Even a Bash allow rule then brings the retry outside the Sandbox to
 * `canUseTool`, where no grant for the command covers it (ADR 0018).
 */
const LEAVING_THE_SANDBOX = 'Bash(dangerouslyDisableSandbox:true)'

/** `//` names an absolute path; with one `/` the rule matches nothing. */
function readDenied(folder: string) {
  return `Read(/${folder}/**)`
}

function sandboxOf(
  {treeFolder, treesFolder, hiddenFolders}: ReplyRequest,
  home: string
): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: false,
    allowUnsandboxedCommands: true,
    // The Sandbox is the floor under the cards, never a reason to skip one.
    autoAllowBashIfSandboxed: false,
    network: {allowedDomains: []},
    filesystem: {
      allowWrite: [treeFolder, os.tmpdir(), ...packageCaches(home)],
      denyRead: [treesFolder, ...credentialFolders(home), ...hiddenFolders],
      allowRead: [treeFolder],
    },
  }
}

/**
 * Supervised runs every command inside the Sandbox where it can run. The
 * deny rules hold for the Read tool, over the hook that lets reads through.
 */
export function sandboxSettings(
  request: ReplyRequest,
  platform: NodeJS.Platform
) {
  if (request.permissionMode === 'full-access') return {}

  const home = os.homedir()

  return {
    sandbox: hasSandbox(platform) ? sandboxOf(request, home) : {enabled: false},
    permissions: {
      deny: [...credentialFolders(home), ...request.hiddenFolders].map(
        readDenied
      ),
      ask: [LEAVING_THE_SANDBOX],
    },
  }
}

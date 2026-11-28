import type {ReplyApprovals} from '#modules/approvals/main'
import type {
  CanUseTool,
  HookCallbackMatcher,
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
  holdsHiddenFolder,
  isAtOrUnder,
  isHidden,
  isInAnotherTree,
  isInTreeFolder,
  isOffLimits,
  namesBelow,
  realPath,
} from '#modules/tree-folder/main'
import os from 'node:os'
import path from 'node:path'
import {z} from 'zod'

import {projectKeyOf} from './transcripts'

export interface SessionApprovals {
  current: ReplyApprovals | null
}

/** Reads never ask, in any mode: `default` asks for one outside `cwd`. */
const READS = 'Read|Glob|Grep'

const EDITS = 'Write|Edit|NotebookEdit'

const DENIED = 'The user denied this.'

const NO_HOST = 'This connection names no host, so it can’t be allowed.'

const CANT_BE_READ = 'This path is in a folder that can’t be read from here.'

const CHANGED_ELSEWHERE =
  'This path is in a folder that can’t be changed from here.'

const ABOVE_THE_TREES =
  'This search covers folders that can’t be read from here. Search a narrower folder.'

const ToolInputSchema = z.object({
  file_path: z.string().min(1).optional().catch(undefined),
  path: z.string().min(1).optional().catch(undefined),
  pattern: z.string().min(1).optional().catch(undefined),
  notebook_path: z.string().min(1).optional().catch(undefined),
  command: z.string().optional().catch(undefined),
  url: z.string().optional().catch(undefined),
  dangerouslyDisableSandbox: z.boolean().optional().catch(undefined),
  host: z.string().min(1).optional().catch(undefined),
})

type ToolInput = z.infer<typeof ToolInputSchema>

const MCP_TOOL = /^mcp__(.+?)__(.+)$/

const SANDBOX_NETWORK = 'SandboxNetworkAccess'

/** `claude` trims a path and expands `~` before resolving it. */
function asClaudeReads(given: string) {
  const trimmed = given.trim()

  if (trimmed === '~') return os.homedir()

  return trimmed.startsWith('~/')
    ? path.join(os.homedir(), trimmed.slice(2))
    : trimmed
}

function withPathsRead(input: ToolInput): ToolInput {
  const {file_path: filePath, path: folder, notebook_path: notebookPath} = input

  return {
    ...input,
    file_path: filePath && asClaudeReads(filePath),
    path: folder && asClaudeReads(folder),
    notebook_path: notebookPath && asClaudeReads(notebookPath),
  }
}

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
  given: ToolInput,
  treeFolder: string
): ApprovalAction {
  const input = withPathsRead(given)
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

  if (host) {
    return toolName === SANDBOX_NETWORK
      ? {kind: 'host', host, fromCommand: true}
      : {kind: 'host', host}
  }

  if (server && tool) return {kind: 'mcp-tool', server, tool}

  return {kind: 'tool', name: toolName}
}

/**
 * A Subagent's call is never shown, and the id of the Sandbox's network prompt
 * names no tool call, so neither card sits at one.
 */
function placeOf(toolName: string, toolUseID: string, agentID?: string) {
  if (agentID) return {subagentId: agentID}

  return toolName === SANDBOX_NETWORK ? {} : {toolCallId: toolUseID}
}

/**
 * `claude`'s own suggestions are never passed back: one for a Write turns the
 * whole session to accepting edits.
 */
export function askOn(
  asking: SessionApprovals,
  treeFolder: string
): CanUseTool {
  return async (toolName, input, {signal, toolUseID, agentID}) => {
    const approvals = asking.current
    const parsed = ToolInputSchema.parse(input)

    // A card with no host would read as one for a tool, and so would its grant.
    if (toolName === SANDBOX_NETWORK && !parsed.host) {
      return {behavior: 'deny', message: NO_HOST}
    }

    const allowed =
      approvals !== null &&
      (await approvals.ask({
        action: actionOf(toolName, parsed, treeFolder),
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

function readTargets(toolName: string, input: ToolInput, treeFolder: string) {
  const {file_path: filePath, path: folder, pattern} = input

  const globbed =
    toolName === 'Glob' && pattern
      ? [path.resolve(treeFolder, folder ?? '.', pattern)]
      : []

  return [filePath, folder, ...globbed].filter(target => target !== undefined)
}

const GLOB_CHARACTER = /[*?[{]/u

function globRoot(searched: string, pattern: string) {
  const wildcardAt = pattern.search(GLOB_CHARACTER)

  return wildcardAt === -1
    ? path.resolve(searched, pattern)
    : path.dirname(path.resolve(searched, `${pattern.slice(0, wildcardAt)}_`))
}

function searchRoots(toolName: string, input: ToolInput, treeFolder: string) {
  const {path: folder, pattern} = input
  const searched = path.resolve(treeFolder, folder ?? '.')

  if (toolName === 'Grep') return [searched]

  return toolName === 'Glob' && pattern ? [globRoot(searched, pattern)] : []
}

type SandboxFolders = Pick<
  ReplyRequest,
  'treeFolder' | 'treesFolder' | 'hiddenFolders'
>

type ReadFolders = SandboxFolders & {configDir: string}

/**
 * Oversized tool output lives under
 * `<configDir>/projects/<key>/<session>/tool-results/`; on Windows the key may
 * hold a short name like `RUNNER~1`.
 */
function isSavedOutput({configDir, treeFolder}: ReadFolders, file: string) {
  const keys = new Set([
    projectKeyOf(treeFolder),
    projectKeyOf(realPath(treeFolder)),
  ])

  return [...keys].some(key => {
    const [, folder] =
      namesBelow(
        path.join(configDir, 'projects', key),
        path.resolve(treeFolder, file)
      ) ?? []

    return folder === 'tool-results'
  })
}

function hiddenRefusal(
  roots: string[],
  file: string | undefined,
  folders: ReadFolders
) {
  const looked = file === undefined ? roots : [file]

  if (
    looked.some(
      target => isHidden(folders, target) && !isSavedOutput(folders, target)
    )
  ) {
    return CANT_BE_READ
  }

  return roots.some(root => holdsHiddenFolder(folders, root))
    ? ABOVE_THE_TREES
    : null
}

function refusal(toolName: string, input: ToolInput, folders: ReadFolders) {
  const {treeFolder} = folders
  const roots = searchRoots(toolName, input, treeFolder)

  if (roots.some(root => holdsEveryTree(folders, root))) return ABOVE_THE_TREES

  if (
    readTargets(toolName, input, treeFolder).some(target =>
      isInAnotherTree(folders, target)
    )
  ) {
    return CANT_BE_READ
  }

  return hiddenRefusal(roots, input.file_path, folders)
}

/**
 * A Read deny rule can't hide the Trees' folder or `claude`'s config folder,
 * since a deny beats every allow and would hide this Tree's own files and saved
 * outputs; the hook refuses those reads instead (ADR 0018).
 */
export function readDecision(
  toolName: string,
  input: ToolInput,
  folders: ReadFolders
): Decision {
  const reason = refusal(toolName, withPathsRead(input), folders)

  return reason === null
    ? {permissionDecision: 'allow'}
    : {permissionDecision: 'deny', permissionDecisionReason: reason}
}

type Decision = Pick<
  PreToolUseHookSpecificOutput,
  'permissionDecision' | 'permissionDecisionReason'
>

/**
 * An edit into another Tree's files or the app's folders is refused, not carded
 * (ADR 0018).
 */
export function editDecision(
  toolName: string,
  input: ToolInput,
  folders: SandboxFolders
): Decision {
  const {file_path: filePath, notebook_path: notebookPath} =
    withPathsRead(input)

  const target = toolName === 'NotebookEdit' ? notebookPath : filePath

  if (target === undefined || !isOffLimits(folders, target)) return {}

  return {
    permissionDecision: 'deny',
    permissionDecisionReason: CHANGED_ELSEWHERE,
  }
}

function preToolUse(
  matcher: string,
  decide: (toolName: string, input: ToolInput) => Decision
): HookCallbackMatcher {
  return {
    matcher,
    hooks: [
      async input => {
        const {tool_name: toolName, tool_input: toolInput} =
          HookInputSchema.parse(input)

        return {
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            ...decide(toolName, toolInput),
          },
        }
      },
    ],
  }
}

export function permissionOptions(
  request: Pick<ReplyRequest, 'permissionMode' | 'vendorProgram'> &
    SandboxFolders,
  asking: SessionApprovals
): Options {
  const {permissionMode, treeFolder, vendorProgram} = request
  const folders = {...request, configDir: vendorProgram.configDir}

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
        preToolUse(READS, (toolName, input) =>
          readDecision(toolName, input, folders)
        ),
        preToolUse(EDITS, (toolName, input) =>
          editDecision(toolName, input, request)
        ),
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
  {treeFolder, treesFolder, hiddenFolders}: SandboxFolders,
  home: string
): SandboxSettings {
  return {
    enabled: true,
    failIfUnavailable: false,
    allowUnsandboxedCommands: true,
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
 * Deny rules beat the read hook, except for the hidden folder holding
 * `claude`'s config folder, which only the hook guards.
 */
export function sandboxSettings(
  request: Pick<ReplyRequest, 'permissionMode' | 'vendorProgram'> &
    SandboxFolders,
  platform: NodeJS.Platform
) {
  if (request.permissionMode === 'full-access') return {}

  const home = os.homedir()
  const {hiddenFolders, vendorProgram} = request

  const denied = hiddenFolders.filter(
    folder => !isAtOrUnder(folder, vendorProgram.configDir)
  )

  return {
    sandbox: hasSandbox(platform) ? sandboxOf(request, home) : {enabled: false},
    permissions: {
      deny: [...credentialFolders(home), ...denied].map(readDenied),
      ask: [LEAVING_THE_SANDBOX],
    },
  }
}

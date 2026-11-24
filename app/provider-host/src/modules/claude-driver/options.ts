import type {Options} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest} from '@uz/contract/host'
import type {CompactionSettings} from '@uz/contract/settings'
import type {TreeTools} from '@uz/contract/tools'

import {explainingLabels} from '#modules/thread-replay/main'

import {claudeReplyEnvironment} from './environment'

/**
 * Named one by one: Claude Code's preset adds tools that outlive the Reply or
 * leave the Tree's folder, such as cron jobs and worktrees.
 */
const TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'NotebookEdit']

const WEB_TOOLS = ['WebFetch', 'WebSearch']

/**
 * On a PC with no Git Bash `claude` offers no `Bash`, so without `PowerShell`
 * the AI could run no command at all (ADR 0026).
 */
function toolsOn(platform: NodeJS.Platform, tools: TreeTools) {
  return [
    ...TOOLS,
    ...(platform === 'win32' ? ['PowerShell'] : []),
    ...(tools.webSearch ? WEB_TOOLS : []),
    // `claude` offers its built-in Skills through this tool alone.
    ...(tools.claudeBuiltInSkills ? ['Skill'] : []),
  ]
}

/** Nothing for a default, so `claude` compacts where it would on its own. */
function claudeSettingsOf({auto, threshold}: CompactionSettings) {
  return {
    ...(auto ? {} : {autoCompactEnabled: false}),
    ...(threshold === null ? {} : {autoCompactWindow: threshold}),
  }
}

export function replyOptions(
  request: ReplyRequest,
  programPath: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): Options {
  return {
    pathToClaudeCodeExecutable: programPath,
    env: claudeReplyEnvironment(env, request.vendorProgram.configDir),
    cwd: request.treeFolder,
    settingSources: [],
    settings: {
      autoMemoryEnabled: false,
      ...claudeSettingsOf(request.compactionSettings),
    },
    tools: toolsOn(platform, request.tools),
    // The app can't show Subagents yet.
    disallowedTools: ['Agent'],
    // Full access, until the Permission mode decides (ADR 0022).
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // Loading no MCP configuration but this keeps the account's connectors out.
    strictMcpConfig: !request.tools.claudeConnectors,
    mcpServers: {},
    // Else a Prompt such as `/compact` is run as a `claude` command.
    verbatimPrompts: true,
    includePartialMessages: true,
    thinking: {type: 'adaptive', display: 'summarized'},
    // On every open, and rendered afresh: else `claude` keeps the first.
    systemPrompt: {
      type: 'preset',
      preset: 'claude_code',
      append: explainingLabels(request.systemPrompt, request.thread),
      snapshot: false,
    },
    model: request.model,
  }
}

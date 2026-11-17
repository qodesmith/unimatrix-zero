import type {Options} from '@anthropic-ai/claude-agent-sdk'
import type {ReplyRequest} from '@uz/contract/host'
import type {CompactionSettings} from '@uz/contract/settings'

import {explainingLabels} from '#modules/thread-replay/main'

import {claudeReplyEnvironment} from './environment'

/**
 * Claude Code's tools for files, commands and the web, named one by one: its
 * preset adds tools that outlive the Reply or leave the Tree's folder, such as
 * cron jobs and worktrees.
 */
const TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'NotebookEdit',
  'WebFetch',
  'WebSearch',
] as const

/** Nothing for a default, so `claude` compacts where it would on its own. */
function claudeSettingsOf({auto, threshold}: CompactionSettings) {
  return {
    ...(auto ? {} : {autoCompactEnabled: false}),
    ...(threshold === null ? {} : {autoCompactWindow: threshold}),
  }
}

/** What a Reply's `claude` runs with, whichever session it opens. */
export function replyOptions(
  request: ReplyRequest,
  programPath: string,
  env: NodeJS.ProcessEnv
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
    tools: [...TOOLS],
    // The app can't show Subagents yet.
    disallowedTools: ['Agent'],
    // Full access, until the Permission mode decides (ADR 0022).
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    strictMcpConfig: true,
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

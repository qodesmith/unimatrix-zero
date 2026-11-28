import type {ReplyRequest} from '@uz/contract/host'

import {
  credentialFolders,
  hasSandbox,
  packageCaches,
} from '#modules/sandbox/main'
import {otherTreeFolders} from '#modules/tree-folder/main'
import os from 'node:os'

export interface LoadedThread {
  id: string
  model: string
  config: ThreadConfig | null
  turns: string[]
  path: string | null
}

type Configured = Pick<
  ReplyRequest,
  | 'compactionSettings'
  | 'tools'
  | 'permissionMode'
  | 'treeFolder'
  | 'treesFolder'
  | 'hiddenFolders'
>

export function isSandboxed(
  {permissionMode}: Pick<ReplyRequest, 'permissionMode'>,
  platform: NodeJS.Platform
) {
  return permissionMode !== 'full-access' && hasSandbox(platform)
}

const PROFILE = 'uz'

/**
 * A permission profile, since a denied read is what stops Codex from running
 * a command again outside the Sandbox, unasked, once the Sandbox blocks it
 * (ADR 0018). `:workspace` writes in `cwd` and temp, with the network off.
 */
function sandboxProfile(
  {treeFolder, treesFolder, hiddenFolders}: Configured,
  home: string
) {
  const denied = [
    ...credentialFolders(home),
    ...hiddenFolders,
    // A command the user lets out of the Sandbox keeps only the denied
    // folders, so denying the folder of every Tree would hide this one too.
    ...otherTreeFolders({treeFolder, treesFolder}),
  ]

  const writable = [treeFolder, ...packageCaches(home)]

  return {
    default_permissions: PROFILE,
    permissions: {
      [PROFILE]: {
        extends: ':workspace',
        filesystem: Object.fromEntries([
          ...denied.map(folder => [folder, 'deny']),
          ...writable.map(folder => [folder, 'write']),
        ]),
      },
    },
  }
}

/**
 * Leaves out a key whose default is Codex's own: a resume without it goes back
 * to that default.
 */
export function configOf(request: Configured, platform: NodeJS.Platform) {
  const {threshold} = request.compactionSettings
  const {tools} = request

  return {
    ...(threshold === null ? {} : {model_auto_compact_token_limit: threshold}),
    ...(tools.webSearch ? {} : {web_search: 'disabled'}),
    'skills.bundled.enabled': tools.chatgptBuiltInSkills,
    'features.plugins': tools.chatgptRemotePlugins,
    'features.apps': tools.chatgptRemotePlugins,
    ...(isSandboxed(request, platform)
      ? sandboxProfile(request, os.homedir())
      : {}),
  }
}

export type ThreadConfig = ReturnType<typeof configOf>

export function loadThread(
  threads: Map<string, LoadedThread>,
  opened: {thread: {id: string; path: string | null}; model: string},
  turns: string[],
  config: ThreadConfig | null
): LoadedThread {
  const thread = {
    id: opened.thread.id,
    model: opened.model,
    config,
    turns,
    path: opened.thread.path,
  }

  threads.set(thread.id, thread)

  return thread
}

import type {ReplyRequest} from '@uz/contract/host'

import {
  credentialFolders,
  hasSandbox,
  packageCaches,
} from '#modules/sandbox/main'
import {namesBelow, realPath} from '#modules/tree-folder/main'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface LoadedThread {
  id: string
  model: string
  /** The `config` Codex loaded it with, which it keeps; null for none. */
  config: ThreadConfig | null
  /** Oldest first: the turn it was opened at, then each one started here. */
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

/** Supervised runs commands inside the Sandbox wherever it can run. */
export function isSandboxed(
  {permissionMode}: Pick<ReplyRequest, 'permissionMode'>,
  platform: NodeJS.Platform
) {
  return permissionMode !== 'full-access' && hasSandbox(platform)
}

const PROFILE = 'uz'

/**
 * Each by name: a command the user lets run outside the Sandbox keeps only the
 * `deny` entries, so denying the folder of every Tree would hide this one too.
 */
function otherTreeFolders({
  treeFolder,
  treesFolder,
}: Pick<Configured, 'treeFolder' | 'treesFolder'>) {
  if (namesBelow(treesFolder, treeFolder)?.length !== 1) return [treesFolder]

  const own = realPath(treeFolder)

  return fs
    .readdirSync(treesFolder)
    .toSorted()
    .map(name => path.join(treesFolder, name))
    .filter(folder => realPath(folder) !== own)
}

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
    // Remote plugins and the connectors that come with them.
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

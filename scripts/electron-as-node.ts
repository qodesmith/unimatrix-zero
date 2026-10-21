import type {SpawnSyncOptions} from 'node:child_process'

import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import {z} from 'zod'

// The `electron` package's main export is the path to its binary.
export const electronPath = z
  .string()
  .parse(createRequire(import.meta.url)('electron'))

/**
 * Runs Electron's binary as plain Node: the exact Node and SQLite the app ships
 * with.
 */
export function runElectronAsNode(
  args: string[],
  options: SpawnSyncOptions = {}
) {
  return spawnSync(electronPath, args, {
    ...options,
    env: {...process.env, ...options.env, ELECTRON_RUN_AS_NODE: '1'},
  })
}

import {spawnSync, type SpawnSyncOptions} from 'node:child_process'
import {createRequire} from 'node:module'

export const electronPath = createRequire(import.meta.url)('electron') as string

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

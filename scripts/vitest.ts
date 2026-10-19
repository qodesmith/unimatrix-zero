/**
 * Runs Vitest under Electron's own Node, so every unit test (and the
 * runtime-match check) sees the exact Node and SQLite the app ships with.
 */
import {spawnSync} from 'node:child_process'
import {createRequire} from 'node:module'
import path from 'node:path'

const electronPath = createRequire(import.meta.url)('electron') as string
const root = path.resolve(import.meta.dirname, '..')
const vitest = path.join(root, 'node_modules/vitest/vitest.mjs')

const result = spawnSync(electronPath, [vitest, ...process.argv.slice(2)], {
  cwd: root,
  env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
  stdio: 'inherit',
})
process.exit(result.status ?? 1)

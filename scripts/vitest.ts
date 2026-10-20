import path from 'node:path'

import {runElectronAsNode} from './electron-as-node'

const root = path.resolve(import.meta.dirname, '..')
const vitest = path.join(root, 'node_modules/vitest/vitest.mjs')

const result = runElectronAsNode([vitest, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
})
process.exit(result.status ?? 1)

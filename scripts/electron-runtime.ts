/**
 * Regenerates electron-runtime.json and .node-version from the installed
 * Electron, so the runtime-match test can pin what the tests ran under.
 */
import {spawnSync} from 'node:child_process'
import {writeFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import path from 'node:path'

const electronPath = createRequire(import.meta.url)('electron') as string
const probe = `
  const {DatabaseSync} = require('node:sqlite')
  const sqlite = new DatabaseSync(':memory:').prepare('select sqlite_version() v').get().v
  const {electron, node, chrome} = process.versions
  console.log(JSON.stringify({electron, node, chrome, sqlite}))
`

const result = spawnSync(electronPath, ['-e', probe], {
  env: {...process.env, ELECTRON_RUN_AS_NODE: '1'},
  encoding: 'utf8',
})
if (result.status !== 0) {
  console.error(result.stderr)
  process.exit(result.status ?? 1)
}

const runtime = JSON.parse(result.stdout.trim()) as Record<string, string>
const root = path.resolve(import.meta.dirname, '..')
writeFileSync(
  path.join(root, 'electron-runtime.json'),
  JSON.stringify(runtime, null, 2) + '\n'
)
writeFileSync(path.join(root, '.node-version'), `${runtime.node}\n`)
console.log(runtime)

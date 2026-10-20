import {writeFileSync} from 'node:fs'
import path from 'node:path'

import {runElectronAsNode} from './electron-as-node'

const probe = `
  const {DatabaseSync} = require('node:sqlite')
  const sqlite = new DatabaseSync(':memory:').prepare('select sqlite_version() v').get().v
  const {electron, node, chrome} = process.versions
  console.log(JSON.stringify({electron, node, chrome, sqlite}))
`

const result = runElectronAsNode(['-e', probe], {encoding: 'utf8'})
if (result.status !== 0) {
  console.error(result.stderr)
  process.exit(result.status ?? 1)
}

const runtime = JSON.parse(String(result.stdout).trim()) as Record<
  string,
  string
>
const root = path.resolve(import.meta.dirname, '..')
writeFileSync(
  path.join(root, 'electron-runtime.json'),
  JSON.stringify(runtime, null, 2) + '\n'
)
writeFileSync(path.join(root, '.node-version'), `${runtime.node}\n`)
console.log(runtime)

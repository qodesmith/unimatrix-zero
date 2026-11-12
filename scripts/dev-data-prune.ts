/**
 * `bun run dev-data:prune [--yes]`, by hand: lists, and with `--yes` deletes,
 * the dev data folders of checkouts `git worktree list` no longer names, with
 * the Claude Keychain entry of each.
 */
import {$} from 'bun'
import fs from 'node:fs'
import path from 'node:path'
import {parseArgs} from 'node:util'

import {
  appData,
  keychainServicesIn,
  planPrune,
  worktreesIn,
} from './dev-data.ts'

const root = path.resolve(import.meta.dirname, '..')
const {values} = parseArgs({options: {yes: {type: 'boolean', default: false}}})
const folder = appData()

const plan = planPrune({
  appDataPath: folder,
  checkouts: worktreesIn(
    await $`git -C ${root} worktree list --porcelain`.text()
  ),
  folders: fs.readdirSync(folder),
  keychain:
    process.platform === 'darwin'
      ? keychainServicesIn(await $`security dump-keychain`.text())
      : [],
})

if (plan.folders.length === 0) {
  console.log('No dev data folders to delete.')
} else {
  console.log(values.yes ? 'Deleting:' : 'Would delete (run with --yes):')

  for (const {name, keychain} of plan.folders) {
    console.log(`  ${name}${keychain ? `  + Keychain "${keychain}"` : ''}`)

    if (!values.yes) continue

    fs.rmSync(path.join(folder, name), {recursive: true, force: true})

    if (keychain)
      await $`security delete-generic-password -s ${keychain}`.quiet()
  }
}

if (plan.unmatched.length > 0) {
  console.log(
    '\nClaude Keychain entries no dev folder owns, left alone (`security delete-generic-password -s <name>` removes one):'
  )

  for (const service of plan.unmatched) console.log(`  ${service}`)
}

import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Variables that would make a vendor program answer to something other than
 * the connected subscription, or read the user's own setup (ADR 0014).
 */
const STRIPPED_PREFIXES = ['ANTHROPIC_', 'CLAUDE_', 'OPENAI_', 'CODEX_']

/** Each driver adds its own folders to this. */
export function vendorEnvironment(base: NodeJS.ProcessEnv) {
  const kept = Object.entries(base).filter(
    (entry): entry is [string, string] =>
      entry[1] !== undefined &&
      !STRIPPED_PREFIXES.some(prefix =>
        entry[0].toUpperCase().startsWith(prefix)
      )
  )

  return Object.fromEntries(kept)
}

/**
 * Whether a Mac has Xcode or the Command Line Tools. `xcode-select -p` fails
 * where it has neither, and unlike the stubs in `/usr/bin` opens no dialog.
 * It succeeds for any `DEVELOPER_DIR`, so it runs without one.
 */
export async function macHasDeveloperTools(base: NodeJS.ProcessEnv) {
  const {DEVELOPER_DIR: _named, ...env} = base

  return new Promise<boolean>(resolve => {
    // A hang counts as none, so a session start never waits on it.
    execFile('/usr/bin/xcode-select', ['-p'], {env, timeout: 10_000}, error => {
      resolve(!error)
    })
  })
}

async function isExecutable(file: string) {
  try {
    await fs.access(file, fs.constants.X_OK)

    return true
  } catch {
    return false
  }
}

/**
 * A stub runs the folder's `xcrun`, so a folder without one is no tools.
 * `DEVELOPER_DIR` may name an Xcode app instead, whose folder is inside it.
 */
async function isDeveloperFolder(folder: string | undefined) {
  if (!folder) return false

  const found = await Promise.all(
    [folder, path.join(folder, 'Contents', 'Developer')].map(async root =>
      isExecutable(path.join(root, 'usr', 'bin', 'xcrun'))
    )
  )

  return found.includes(true)
}

/**
 * Names the app's developer folder to a Mac with no developer tools right now
 * (ADR 0025): none of its own, and none in a `DEVELOPER_DIR` the user set.
 * Main names a folder on a Mac alone.
 */
export async function withDeveloperDir(
  base: NodeJS.ProcessEnv,
  developerDir: string | undefined,
  hasDeveloperTools: typeof macHasDeveloperTools
) {
  if (!developerDir || (await hasDeveloperTools(base))) return base

  if (await isDeveloperFolder(base.DEVELOPER_DIR)) return base

  return {...base, DEVELOPER_DIR: developerDir}
}

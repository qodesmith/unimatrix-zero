import type {SignInRequest} from '@uz/contract/host'

import {execFile} from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

/** Each aims a vendor program at another account or user setup (ADR 0014). */
const STRIPPED_PREFIXES = ['ANTHROPIC_', 'CLAUDE_', 'OPENAI_', 'CODEX_']

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
 * Unlike the `/usr/bin` stubs, opens no dialog. Passes for any `DEVELOPER_DIR`,
 * so it runs without one.
 */
export async function macHasDeveloperTools(
  base: NodeJS.ProcessEnv,
  xcodeSelect = '/usr/bin/xcode-select'
) {
  const {DEVELOPER_DIR: _named, ...env} = base

  return new Promise<boolean>(resolve => {
    execFile(xcodeSelect, ['-p'], {env, timeout: 10_000}, error => {
      // Only an exit has a numeric code. A hang or failed start counts as
      // having the tools (ADR 0025).
      resolve(!Number.isInteger(error?.code))
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

/** Stubs run the folder's `xcrun`. `DEVELOPER_DIR` may name an Xcode app. */
async function isDeveloperFolder(folder: string | undefined) {
  if (!folder) return false

  const found = await Promise.all(
    [folder, path.join(folder, 'Contents', 'Developer')].map(async root =>
      isExecutable(path.join(root, 'usr', 'bin', 'xcrun'))
    )
  )

  return found.includes(true)
}

export async function withDeveloperDir(
  base: NodeJS.ProcessEnv,
  developerDir: string | undefined,
  hasDeveloperTools: typeof macHasDeveloperTools
) {
  if (!developerDir || (await hasDeveloperTools(base))) return base

  if (await isDeveloperFolder(base.DEVELOPER_DIR)) return base

  return {...base, DEVELOPER_DIR: developerDir}
}

/** Last, so the user's own `git` wins (ADR 0026). */
export function withGitLast(
  base: NodeJS.ProcessEnv,
  gitFolder: string | undefined
) {
  if (!gitFolder) return base

  // A copy of a Windows environment holds it as `Path`.
  const name =
    Object.keys(base).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'

  const own = base[name]

  return {
    ...base,
    [name]: own ? `${own}${path.delimiter}${gitFolder}` : gitFolder,
  }
}

export async function withAppFolders(
  base: NodeJS.ProcessEnv,
  {developerDir, gitFolder}: Pick<SignInRequest, 'developerDir' | 'gitFolder'>,
  hasDeveloperTools: typeof macHasDeveloperTools
) {
  return withGitLast(
    await withDeveloperDir(base, developerDir, hasDeveloperTools),
    gitFolder
  )
}

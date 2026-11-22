import {execFile} from 'node:child_process'

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
 */
export async function macHasDeveloperTools(env: NodeJS.ProcessEnv) {
  return new Promise<boolean>(resolve => {
    // A hang counts as none, so a session start never waits on it.
    execFile('/usr/bin/xcode-select', ['-p'], {env, timeout: 10_000}, error => {
      resolve(!error)
    })
  })
}

/**
 * Names the app's developer folder to a Mac with no developer tools right now
 * (ADR 0025). Main names a folder on a Mac alone.
 */
export async function withDeveloperDir(
  base: NodeJS.ProcessEnv,
  developerDir: string | undefined,
  hasDeveloperTools: typeof macHasDeveloperTools
) {
  if (!developerDir || (await hasDeveloperTools(base))) return base

  return {...base, DEVELOPER_DIR: developerDir}
}
